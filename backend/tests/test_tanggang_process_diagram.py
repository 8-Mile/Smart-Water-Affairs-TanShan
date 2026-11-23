"""M14: preserve editing/publishing with isolated SQLite and strict RBAC."""
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
from app.models.tanggang_process_diagram import (
    TanggangProcessDiagram, TanggangProcessDiagramRevision,
)
from app.models.equipment import Equipment
from app.models.ai_audit import AiAuditLog

API = '/api/v1/tanggang/process-diagrams/fog'


@pytest.fixture
def env(monkeypatch):
    engine = create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
    Base.metadata.create_all(bind=engine, tables=[
        User.__table__,Role.__table__,Menu.__table__,RoleMenu.__table__,UserRole.__table__,
        TanggangProcessDiagram.__table__,TanggangProcessDiagramRevision.__table__,
        Equipment.__table__,AiAuditLog.__table__,
    ])
    Session=sessionmaker(bind=engine,expire_on_commit=False)
    with Session() as db:
        roles={}
        for name in ['manager','editor','reader']:
            r=Role(name=name,code='diagram_'+name,status=1,deleted=0)
            db.add(r);db.flush();roles[name]=r
        perms={}
        for i,name in enumerate(['eq:update','sys:menu:manage']):
            m=Menu(name=name,perms=name,menu_type='button',parent_id=0,
                   sort=i+1,visible=1,status=1,deleted=0)
            db.add(m);db.flush();perms[name]=m
        db.add(RoleMenu(role_id=roles['manager'].id,menu_id=perms['sys:menu:manage'].id))
        db.add(RoleMenu(role_id=roles['editor'].id,menu_id=perms['eq:update'].id))
        users={}
        for name in roles:
            user=User(username='diagram_'+name,password_hash=uuid.uuid4().hex,
                      display_name=name,role_code=roles[name].code,status=1,deleted=0)
            db.add(user);db.flush()
            users[name]=user.id
            db.add(UserRole(user_id=user.id,role_id=roles[name].id))
        db.commit()
    current={'name':'reader'}
    def session():
        with Session() as db:yield db
    def auth():
        with Session() as db:
            u=db.get(User,users[current['name']])
            db.expunge(u);return u
    app.dependency_overrides[get_db]=session
    app.dependency_overrides[get_current_user]=auth
    monkeypatch.setattr('app.core.middleware.SessionLocal',Session)
    client=TestClient(app)
    try:
        yield client,current,Session
    finally:
        client.close()
        app.dependency_overrides.pop(get_db,None)
        app.dependency_overrides.pop(get_current_user,None)
        engine.dispose()


def doc(**changes):
    original={
        'system_id':'fog','name':'射雾器除尘工艺图',
        'view_box':{'width':1200,'height':530},'background':'light-grid',
        'nodes':[{
          'id':'pump-node','symbol_id':'centrifugal_pump',
          'facility_id':'EQ-P-FOG','label':'射雾器供水泵组',
          'position':{'x':280,'y':160},'size':{'width':96,'height':94},
          'point_keys':['出口压力','供水流量'],'visible':True,'locked':False,
        },{
          'id':'fog-node','symbol_id':'fog_cannon',
          'facility_id':'EQ-Y-FOG','label':'室内射雾器',
          'position':{'x':630,'y':150},'size':{'width':98,'height':105},
          'point_keys':['压力'],'visible':True,'locked':False,
        }],
        'connections':[{'id':'line-one','source_node_id':'pump-node',
                        'target_node_id':'fog-node','medium':'water',
                        'verification':'illustrative'}],
    }
    original.update(changes)
    return original


def test_read_draft_publish_versions_and_revert_are_server_persisted(env):
    client,current,Session=env
    first=client.get(API).json()['data']
    assert first['published'] is None and first['revision']==0
    assert first['can_edit'] is False
    current['name']='editor'
    saved=client.put(API+'/draft',json={'revision':0,'diagram':doc()})
    assert saved.status_code==200,saved.text
    stored=saved.json()['data']
    assert stored['draft']['nodes'][0]['facility_id']=='EQ-P-FOG'
    assert stored['revision']==1 and stored['published'] is None
    assert client.get(API+'/history').json()['data']==[]
    current['name']='reader'
    read=client.get(API).json()['data']
    assert read['draft'] is None and read['published'] is None
    assert read['can_edit'] is False
    assert client.put(API+'/draft',json={'revision':1,'diagram':doc()}).status_code==403
    assert client.post(API+'/publish',json={'revision':1}).status_code==403
    current['name']='editor'
    assert client.post(API+'/publish',json={'revision':1}).status_code==403
    current['name']='manager'
    published=client.post(API+'/publish',json={'revision':1})
    assert published.status_code==200,published.text
    p=published.json()['data']
    assert p['published_version']==1 and p['revision']==2
    assert p['draft'] is None and p['published']['connections'][0]['verification']=='illustrative'
    current['name']='reader'
    read=client.get(API).json()['data']
    assert read['published_version']==1 and read['published']['nodes'][0]['label']=='射雾器供水泵组'
    assert read['can_edit'] is False and read['control_enabled'] is False
    current['name']='editor'
    changed=doc(name='射雾器组态·修改第二版')
    changed['nodes'][0]['label']='更新后的演示泵组'
    newer=client.put(API+'/draft',json={'revision':2,'diagram':changed})
    assert newer.status_code==200
    assert newer.json()['data']['published']['nodes'][0]['label']=='射雾器供水泵组'
    assert newer.json()['data']['draft']['nodes'][0]['label']=='更新后的演示泵组'
    current['name']='manager'
    second=client.post(API+'/publish',json={'revision':3})
    assert second.status_code==200
    assert second.json()['data']['published_version']==2
    versions=client.get(API+'/history').json()['data']
    assert [v['version'] for v in versions]==[2,1]
    restored=client.post(API+'/restore',json={'revision':4,'version':1})
    assert restored.status_code==200,restored.text
    assert restored.json()['data']['draft']['nodes'][0]['label']=='射雾器供水泵组'
    assert restored.json()['data']['published']['nodes'][0]['label']=='更新后的演示泵组'
    assert restored.json()['data']['published_version']==2
    final=client.post(API+'/publish',json={'revision':5})
    assert final.status_code==200
    assert final.json()['data']['published_version']==3
    with Session() as db:
        assert db.query(TanggangProcessDiagram).count()==1
        assert db.query(TanggangProcessDiagramRevision).count()==6
        assert db.query(Equipment).count()==0
        assert db.query(AiAuditLog).count()==0


def test_reject_cross_version_and_untrusted_symbols_points_connections(env):
    client,current,Session=env
    current['name']='editor'
    saved=client.put(API+'/draft',json={'revision':0,'diagram':doc()})
    assert saved.status_code==200
    assert client.put(API+'/draft',json={'revision':0,'diagram':doc()}).status_code==409
    current['name']='manager'
    assert client.post(API+'/publish',json={'revision':0}).status_code==409
    assert client.post(API+'/restore',json={'revision':1,'version':1}).status_code==404
    invalid=[
        doc(system_id='middle'),
        doc(background='https://unknown.example/tracker.png'),
        doc(nodes=[{**doc()['nodes'][0],'symbol_id':'<script>fetch()</script>'}]),
        doc(nodes=[{**doc()['nodes'][0],'facility_id':'EQ-REAL-PLC'}]),
        doc(nodes=[{**doc()['nodes'][0],'point_keys':['用户未上传的设备压力值']}]),
        doc(nodes=[doc()['nodes'][0],{**doc()['nodes'][0],'id':'duplicate-pump'}]),
        doc(nodes=[{**doc()['nodes'][0],'position':{'x':1199,'y':0}}]),
        doc(connections=[{**doc()['connections'][0],'target_node_id':'never-existed'}]),
        doc(connections=[{**doc()['connections'][0],'verification':'field_verified'}]),
        doc(connections=[{**doc()['connections'][0],'medium':'exec()'}]),
        doc(nodes=[{**doc()['nodes'][0],'point_keys':['出口压力'],
                    'facility_id':None}]),
        doc(nodes=[{**doc()['nodes'][0],'asset_id':728}]),
    ]
    for candidate in invalid:
        resp=client.put(API+'/draft',json={'revision':1,'diagram':candidate})
        assert resp.status_code in [400,422],(candidate,resp.status_code,resp.text)
    assert client.get(API+'/history').json()['data']==[]
    with Session() as db:
        assert db.query(TanggangProcessDiagram).count()==1
        assert db.query(TanggangProcessDiagramRevision).count()==1
        assert db.query(Equipment).count()==0


def test_six_process_diagrams_have_isolated_drafts_and_published_versions(env):
    from app.api.tanggang_process_diagram import CAD_FACILITIES,CAD_POINT_FIELDS,SYSTEMS
    client,current,Session=env
    current['name']='manager'
    for sid in SYSTEMS:
        endpoint='/api/v1/tanggang/process-diagrams/'+sid
        first=client.get(endpoint)
        assert first.status_code==200,first.text
        assert first.json()['data']['system_id']==sid
        facility=sorted(CAD_FACILITIES[sid])[0]
        point=sorted(CAD_POINT_FIELDS[facility])[0]
        diagram={
            'system_id':sid,'name':SYSTEMS[sid]+'设计组态',
            'view_box':{'width':1160,'height':500},'background':'light-grid',
            'nodes':[{
                'id':'cad-node-1','symbol_id':'generic_equipment',
                'facility_id':facility,'label':'CAD设施',
                'position':{'x':140,'y':160},
                'size':{'width':130,'height':90},
                'point_keys':[point],'visible':True,'locked':False,
            }],
            'connections':[],
        }
        saved=client.put(endpoint+'/draft',json={'revision':0,'diagram':diagram})
        assert saved.status_code==200,saved.text
        assert saved.json()['data']['published'] is None
        published=client.post(endpoint+'/publish',json={'revision':1})
        assert published.status_code==200,published.text
        assert published.json()['data']['published']['system_id']==sid
        assert published.json()['data']['published_version']==1
        assert client.get(endpoint+'/history').json()['data'][0]['version']==1
        for other in SYSTEMS:
            if other==sid:continue
            another=client.get('/api/v1/tanggang/process-diagrams/'+other).json()['data']
            assert another['published_version']==(1 if list(SYSTEMS).index(other)<list(SYSTEMS).index(sid) else 0)
    with Session() as db:
        assert db.query(TanggangProcessDiagram).count()==6
        assert db.query(Equipment).count()==0
        assert db.query(AiAuditLog).count()==0


def test_unknown_process_diagram_is_rejected(env):
    client,current,Session=env
    current['name']='manager'
    for sid in ['not-a-system','../system']:
        from urllib.parse import quote
        r=client.get('/api/v1/tanggang/process-diagrams/'+quote(sid,safe=''))
        assert r.status_code in [404,400],(sid,r.status_code)
