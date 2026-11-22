"""Server-backed A2UI tests: isolate real water_ops and prohibit arbitrary code."""
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import get_current_user
from app.main import app
from app.models.user import User
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.archive import OperationLog
from app.models.tanggang_board import TanggangBoard, TanggangBoardRevision
from app.models.tanggang_equipment_draft import TanggangDemoEquipment
from app.models.equipment import Equipment

API='/api/v1/tanggang/boards'

@pytest.fixture
def env(monkeypatch):
    engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(bind=engine,tables=[
        User.__table__,Role.__table__,Menu.__table__,
        RoleMenu.__table__,UserRole.__table__,
        TanggangBoard.__table__,TanggangBoardRevision.__table__,
        TanggangDemoEquipment.__table__,Equipment.__table__,
        OperationLog.__table__,
    ])
    Session=sessionmaker(bind=engine,expire_on_commit=False)
    with Session() as db:
        m=Menu(name='菜单管理',perms='sys:menu:manage',menu_type='button',parent_id=0,
               sort=1,visible=1,status=1,deleted=0)
        create_menu=Menu(name='设备创建',perms='eq:create',menu_type='button',parent_id=0,
                         sort=2,visible=1,status=1,deleted=0)
        db.add(create_menu)
        manager=Role(name='管理员',code='tg_board_admin',status=1,deleted=0)
        viewer=Role(name='查看者',code='tg_board_viewer',status=1,deleted=0)
        other=Role(name='未授权角色',code='tg_board_other',status=1,deleted=0)
        db.add_all([m,manager,viewer,other]);db.flush()
        users={}
        for name,role in [('author',viewer),('publisher',manager),('reader',viewer),('other',other)]:
            u=User(username='board_'+name,password_hash=uuid.uuid4().hex,display_name=name,
                   role_code=role.code,status=1,deleted=0)
            db.add(u);db.flush()
            users[name]=u.id
            db.add(UserRole(user_id=u.id,role_id=role.id))
        db.add(RoleMenu(role_id=manager.id,menu_id=m.id))
        db.add(RoleMenu(role_id=manager.id,menu_id=create_menu.id))
        db.commit()
    current={'name':'author'}
    def get_session():
        with Session() as db:yield db
    def get_user():
        with Session() as db:
            u=db.get(User,users[current['name']])
            db.expunge(u);return u
    app.dependency_overrides[get_db]=get_session
    app.dependency_overrides[get_current_user]=get_user
    monkeypatch.setattr('app.core.middleware.SessionLocal',Session)
    client=TestClient(app)
    try:yield client,current,Session
    finally:
        client.close()
        app.dependency_overrides.pop(get_db,None)
        app.dependency_overrides.pop(get_current_user,None)
        engine.dispose()


def body(**changes):
    x={'title':'演示供水分析','target_path':'/port/water/supply',
       'widgets':[{'id':'w1','kind':'metric','metric':'supply-shortage'},
                  {'id':'w2','kind':'terminal-table','metric':None}]}
    x.update(changes)
    return x


def test_white_list_catalog_and_real_persistence(env):
    client,current,Session=env
    cat=client.get(API+'/catalog')
    assert cat.status_code==200,cat.text
    assert cat.json()['data']['stage']=='DOCUMENT_BASED_DEMO'
    assert len(cat.json()['data']['targets'])==2
    created=client.post(API,json=body())
    assert created.status_code==200,created.text
    b=created.json()['data']
    assert b['data_mode']=='SIM' and b['field_verified'] is False
    assert b['status']=='draft' and b['version']==1
    mine=client.get(API+'/mine').json()['data']
    assert len(mine)==1
    assert mine[0]['widgets']==body()['widgets']
    assert client.get(API+'/published',params={'target_path':'/port/water/supply'}).json()['data']==[]
    with Session() as db:
        assert db.query(TanggangBoard).count()==1
        assert db.query(TanggangBoardRevision).count()==1


def test_reject_arbitrary_script_and_invalid_bindings(env):
    client,*_=env
    for bad in [
        body(widgets=[{'id':'w1','kind':'script','code':'alert(1)'}]),
        body(widgets=[{'id':'w1','kind':'metric','metric':'secret-data'}]),
        body(widgets=[{'id':'w1','kind':'metric','metric':'supply-shortage','script':'fetch()'}]),
        body(widgets=[{'id':'w1','kind':'metric','metric':None}]),
        body(widgets=[{'id':'w1','kind':'monitor-rules','metric':'supply-shortage'}]),
        body(widgets=[{'id':'w1','kind':'metric','metric':'supply-shortage'},
                      {'id':'w1','kind':'metric','metric':'pool-forecast'}]),
        body(widgets=[{'id':'w1','kind':'metric','metric':'supply-shortage'}]*9),
        body(target_path='/dashboard'),
    ]:
        r=client.post(API,json=bad)
        assert r.status_code==422,r.text


def test_publish_role_target_visibility_and_revoke(env):
    client,current,Session=env
    b=client.post(API,json=body()).json()['data']
    rid=b['id']
    denied=client.post(API+'/'+str(rid)+'/publish',json={
        'version':1,'allowed_role_codes':['tg_board_viewer'],
    })
    assert denied.status_code==403,denied.text
    current['name']='publisher'
    roles=client.get(API+'/roles')
    assert roles.status_code==200,roles.text
    assert any(r['code']=='tg_board_viewer' for r in roles.json()['data'])
    published=client.post(API+'/'+str(rid)+'/publish',json={
        'version':1,'allowed_role_codes':['tg_board_viewer'],
    })
    assert published.status_code==200,published.text
    assert published.json()['data']['version']==2
    assert published.json()['data']['status']=='published'
    current['name']='reader'
    listings=client.get(API+'/published',params={'target_path':'/port/water/supply'})
    assert [x['id'] for x in listings.json()['data']]==[rid]
    assert client.get(API+'/'+str(rid)).status_code==200
    assert client.get(API+'/published',params={'target_path':'/port/operations/monitor'}).json()['data']==[]
    current['name']='other'
    assert client.get(API+'/published',params={'target_path':'/port/water/supply'}).json()['data']==[]
    assert client.get(API+'/'+str(rid)).status_code==403
    current['name']='author'
    assert client.put(API+'/'+str(rid),json=body(version=2,title='改名')).status_code==409
    current['name']='publisher'
    revoked=client.post(API+'/'+str(rid)+'/revoke',json={'version':2})
    assert revoked.status_code==200,revoked.text
    assert revoked.json()['data']['status']=='draft'
    current['name']='reader'
    assert client.get(API+'/published',params={'target_path':'/port/water/supply'}).json()['data']==[]
    current['name']='publisher'
    history=client.get(API+'/'+str(rid)+'/history').json()['data']
    assert [x['action'] for x in history]==['revoke','publish','create']
    assert [x['version'] for x in history]==[3,2,1]
    with Session() as db:
        assert db.query(TanggangBoard).count()==1


def test_edit_refresh_and_version_conflict(env):
    client,current,Session=env
    b=client.post(API,json=body()).json()['data']
    bid=b['id']
    change=client.put(API+'/'+str(bid),json=body(
        version=1,title='监护规则核查',
        target_path='/port/operations/monitor',
        widgets=[{'id':'w3','kind':'monitor-rules','metric':None}]))
    assert change.status_code==200,change.text
    changed=change.json()['data']
    assert changed['version']==2
    assert changed['target_path']=='/port/operations/monitor'
    assert client.put(API+'/'+str(bid),json=body(version=1)).status_code==409
    current['name']='other'
    assert client.get(API+'/'+str(bid)).status_code==403
    assert client.put(API+'/'+str(bid),json=body(version=2)).status_code==403


def test_invalid_or_deleted_role_cannot_receive_board(env):
    client,current,Session=env
    b=client.post(API,json=body()).json()['data']
    current['name']='publisher'
    invalid=client.post(API+'/'+str(b['id'])+'/publish',json={
        'version':1,'allowed_role_codes':['nonexistent'],
    })
    assert invalid.status_code==400,invalid.text
    assert client.get(API+'/'+str(b['id'])).json()['data']['status']=='draft'
    malformed=client.post(API+'/'+str(b['id'])+'/publish',json={
        'version':1,'allowed_role_codes':['tg_board_viewer','tg_board_viewer'],
    })
    assert malformed.status_code==422


def test_published_lists_only_right_role_even_when_owner_other(env):
    client,current,Session=env
    b=client.post(API,json=body()).json()['data']
    current['name']='publisher'
    assert client.post(API+'/'+str(b['id'])+'/publish',json={
        'version':1,'allowed_role_codes':['tg_board_other'],
    }).status_code==200
    current['name']='author'
    # Owner can still open own board but is not automatically a member of the
    # publication's designated audience.
    assert client.get(API+'/'+str(b['id'])).status_code==200
    assert client.get(API+'/published',params={'target_path':'/port/water/supply'}).json()['data']==[]


DRAFT='/api/v1/tanggang/demo-equipment'

def test_natural_language_demo_parse_is_only_template_not_fake_llm(env):
    client,current,Session=env
    result=client.post(DRAFT+'/parse',json={
        'text':'在除尘系统新增设备，设备名称：演示喷雾泵，设备编号：SIM-FOG-01，参数：设计参数待核',
    })
    assert result.status_code==200,result.text
    parsed=result.json()['data']
    assert parsed['parse_mode']=='CONTROLLED_TEMPLATE_NOT_LLM'
    assert parsed['system_id']=='fog'
    assert parsed['name']=='演示喷雾泵'
    assert parsed['code']=='SIM-FOG-01'
    assert parsed['data_mode']=='SIM'
    assert parsed['missing']==[]
    incomplete=client.post(DRAFT+'/parse',json={
        'text':'在除尘系统新增设备xx号，参数待定',
    }).json()['data']
    assert '设备名称' in incomplete['missing']
    assert '设备编号' in incomplete['missing']
    ambiguous=client.post(DRAFT+'/parse',json={
        'text':'除尘系统与中压系统新增一台设备',
    }).json()['data']
    assert ambiguous['system_id'] is None
    with Session() as db:
        assert db.query(TanggangDemoEquipment).count()==0
        assert db.query(Equipment).count()==0


def test_demo_equipment_confirm_isolated_from_official_table_and_scada(env):
    client,current,Session=env
    payload={
        'system_id':'fog','name':'演示喷雾泵','code':'SIM-FOG-01',
        'parameters_note':'仅软件演示的设计参数假设',
        'request_text':'在除尘系统新增设备，设备名称：演示喷雾泵，设备编号：SIM-FOG-01',
        'source_note':'仅软件演示假设，尚未获得唐港现场实测数据',
        'confirmed':True,
    }
    assert client.post(DRAFT,json=payload).status_code==403
    current['name']='publisher'
    no_confirm=client.post(DRAFT,json={**payload,'confirmed':False})
    assert no_confirm.status_code==422,no_confirm.text
    created=client.post(DRAFT,json=payload)
    assert created.status_code==200,created.text
    obj=created.json()['data']
    assert obj['in_official_equipment'] is False
    assert obj['field_verified'] is False
    assert obj['data_mode']=='SIM'
    dup=client.post(DRAFT,json=payload)
    assert dup.status_code==409,dup.text
    mine=client.get(DRAFT).json()['data']
    assert mine['total']==1
    assert mine['items'][0]['code']=='SIM-FOG-01'
    with Session() as db:
        assert db.query(TanggangDemoEquipment).count()==1
        assert db.query(Equipment).count()==0
    current['name']='reader'
    assert client.get(DRAFT).json()['data']['total']==0
    assert client.get(DRAFT+'/'+str(obj['id'])).status_code==404


def test_demo_device_rejects_invalid_payloads(env):
    client,current,Session=env
    current['name']='publisher'
    body={
        'system_id':'fog','name':'演示测试泵','code':'SIM-TEST-01',
        'parameters_note':None,
        'request_text':'在除尘系统增加演示设备 SIM-TEST-01',
        'source_note':'只有软件演示假设，没有现场核验',
        'confirmed':True,
    }
    for patch in [
        {'system_id':'invalid'},
        {'code':'名称含空格'},
        {'source_note':''},
        {'confirmed':False},
    ]:
        res=client.post(DRAFT,json={**body,**patch})
        assert res.status_code==422,res.text
    with Session() as db:
        assert db.query(TanggangDemoEquipment).count()==0
