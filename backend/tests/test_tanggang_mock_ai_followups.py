"""M5 continuation: versioned white-list board edits and traceable SIM replay."""
import json

from test_tanggang_mock_ai import mock_env,ask
from test_tanggang_a2ui_boards import API as BOARD_API,body,env
from app.models.tanggang_board import TanggangBoard,TanggangBoardRevision
from app.models.tanggang_mock_ai import TanggangMockAiReport
from app.models.ai_audit import AiAuditLog
from app.models.equipment import Equipment
from app.models.tanggang_equipment_draft import TanggangDemoEquipment

API='/api/v1/ai'
CONTEXT={
  'data_mode':'SIM','field_verified':False,'scenario_id':'peak','run_number':3,
  'scenario_started_at':'2026-11-22T14:01:00Z','demand_m3h':139,
  'delivered_m3h':105,'shortage_m3h':34,'coverage_percent':75.5,
  'pool_forecast_m3':350,'monitor_risk':'attention',
  'triggered_rules':['运行时高电流'],'insufficient_rules':[],
  'affected_terminals':[{'label':'演示用水点 D','demand_m3h':45,
                         'allocated_m3h':11,'shortage_m3h':34}],
  'checkpoints':['核对SCADA测点','核对供水终端需求','核对泵组设备厂家参数'],
  'review_status':'recorded','review_outcome':'requires-field-check',
  'review_note':'已完成SIM核查意见录入，但尚未取得现场采样及泵组铭牌证据',
}


def test_add_widget_by_existing_board_id_with_confirm_and_revision(mock_env):
    client,current,Session=mock_env
    created=client.post(BOARD_API,json=body()).json()['data']
    bid=created['id']
    outcome=ask(client,f'给{bid}号看板添加需求覆盖率指标')
    assert outcome.status_code==200,outcome.text
    action=outcome.json()['data']['pending_actions'][0]
    assert action['tool']=='edit_sim_board'
    assert action['payload']['expected_version']==1
    assert action['payload']['operation']=='add'
    assert action['payload']['component_metric']=='supply-coverage'
    with Session() as db:
        assert len(json.loads(db.get(TanggangBoard,bid).widgets_json))==2
    result=client.post(API+'/confirm',json={'action_id':action['action_id']})
    assert result.status_code==200,result.text
    assert result.json()['data']['result']['version']==2
    assert result.json()['data']['result']['path']=='/port/analysis/boards'
    assert client.post(API+'/confirm',json={'action_id':action['action_id']}).status_code==409
    with Session() as db:
        board=db.get(TanggangBoard,bid)
        assert board.version==2
        assert len(json.loads(board.widgets_json))==3
        assert db.query(TanggangBoardRevision).count()==2
        assert db.query(Equipment).count()==0
    minus=ask(client,f'从{bid}号看板移除需求覆盖率')
    assert minus.status_code==200
    action2=minus.json()['data']['pending_actions'][0]
    assert action2['payload']['operation']=='remove'
    assert client.post(API+'/confirm',json={'action_id':action2['action_id']}).status_code==200
    with Session() as db:
        assert db.get(TanggangBoard,bid).version==3
        assert len(json.loads(db.get(TanggangBoard,bid).widgets_json))==2


def test_board_edit_ambiguous_published_or_version_conflict_fails_closed(mock_env):
    client,current,Session=mock_env
    first=client.post(BOARD_API,json=body()).json()['data']
    second=client.post(BOARD_API,json=body(title='第二个看板')).json()['data']
    ambiguous=ask(client,'我的看板添加供水缺口')
    assert not ambiguous.json()['data']['pending_actions']
    assert str(first['id']) in ambiguous.json()['data']['reply']
    explicit=ask(client,f'给{first["id"]}号看板添加需求覆盖率')
    aid=explicit.json()['data']['pending_actions'][0]['action_id']
    changed=client.put(BOARD_API+'/'+str(first['id']),json=body(
        version=1,title='更新后的草稿',
    ))
    assert changed.status_code==200
    conflict=client.post(API+'/confirm',json={'action_id':aid})
    assert conflict.status_code==409
    with Session() as db:
        board=db.get(TanggangBoard,first['id'])
        assert board.version==2
        assert len(json.loads(board.widgets_json))==2
    current['name']='publisher'
    published=client.post(BOARD_API+'/'+str(first['id'])+'/publish',json={
        'version':2,'allowed_role_codes':['tg_board_viewer'],
    })
    assert published.status_code==200
    current['name']='author'
    blocked=ask(client,f'给{first["id"]}号看板添加需求覆盖率')
    assert blocked.json()['data']['pending_actions']==[]
    assert '先由有权限' in blocked.json()['data']['reply']
    other=ask(client,f'给{second["id"]}号看板添加不存在的设备健康预测图')
    assert other.json()['data']['pending_actions']==[]
    assert '白名单' in other.json()['data']['reply']


def test_board_edit_owner_only_cancel_and_minimum_widget(mock_env):
    client,current,Session=mock_env
    bid=client.post(BOARD_API,json=body()).json()['data']['id']
    action=ask(client,f'给{bid}号看板添加监护规则').json()['data']['pending_actions'][0]
    canceled=client.post(API+'/cancel',json={'action_id':action['action_id']})
    assert canceled.status_code==200
    assert client.post(API+'/confirm',json={'action_id':action['action_id']}).status_code==409
    current['name']='other'
    denied=ask(client,f'给{bid}号看板添加监护规则')
    assert not denied.json()['data']['pending_actions']
    current['name']='author'
    with Session() as db:
        assert len(json.loads(db.get(TanggangBoard,bid).widgets_json))==2
    # Cannot delete the only remaining widget.
    single=client.post(BOARD_API,json=body(
        title='单组件看板',
        widgets=[{'id':'w1','kind':'metric','metric':'supply-shortage'}],
    )).json()['data']
    refused=ask(client,f'给{single["id"]}号看板移除供水缺口指标')
    assert refused.json()['data']['pending_actions']==[]


def test_report_preview_confirm_persist_source_and_user_isolation(mock_env):
    client,current,Session=mock_env
    missing=ask(client,'生成本轮SIM运行复盘报告')
    assert missing.status_code==200
    assert not missing.json()['data']['pending_actions']
    created=ask(client,'生成本轮SIM运行复盘报告',context=CONTEXT)
    assert created.status_code==200,created.text
    pa=created.json()['data']['pending_actions'][0]
    assert pa['tool']=='create_sim_report'
    assert pa['payload']['shortage_m3h']==34
    assert pa['payload']['affected_terminals'][0]['label']=='演示用水点 D'
    assert pa['payload']['review_note']==CONTEXT['review_note']
    assert pa['payload']['data_origin']=='BROWSER_SIM_SNAPSHOT'
    with Session() as db:
        assert db.query(TanggangMockAiReport).count()==0
    confirmed=client.post(API+'/confirm',json={'action_id':pa['action_id']})
    assert confirmed.status_code==200,confirmed.text
    output=confirmed.json()['data']['result']
    assert output['path']=='/port/analysis/reports'
    assert output['field_verified'] is False
    reports=client.get(API+'/mock-reports')
    assert reports.status_code==200,reports.text
    rows=reports.json()['data']
    assert len(rows)==1
    r=rows[0]['report']
    assert r['report_version']=='tg-sim-replay-v1'
    assert r['data_mode']=='SIM' and r['field_verified'] is False
    assert r['production_case_created'] is False and r['repair_order_created'] is False
    assert r['review_status']=='recorded'
    assert r['checkpoints']==CONTEXT['checkpoints']
    assert client.get(API+'/mock-reports/'+str(rows[0]['id'])).status_code==200
    current['name']='other'
    assert client.get(API+'/mock-reports').json()['data']==[]
    assert client.get(API+'/mock-reports/'+str(rows[0]['id'])).status_code==404
    with Session() as db:
        assert db.query(Equipment).count()==0
        assert db.query(TanggangDemoEquipment).count()==0
        assert db.query(AiAuditLog).count()==1


def test_report_invalid_context_or_cancel_cannot_create_record(mock_env):
    client,current,Session=mock_env
    for patch in [
        {'data_mode':'MEASURED'},
        {'field_verified':True},
        {'demand_m3h':-10},
        {'affected_terminals':[{'label':'恶意输入','shortage_m3h':-2}]},
    ]:
        context={**CONTEXT,**patch}
        assert ask(client,'生成本轮运行复盘',context=context).status_code==422
    action=ask(client,'生成本轮运行复盘',context=CONTEXT).json()['data']['pending_actions'][0]
    result=client.post(API+'/cancel',json={'action_id':action['action_id']})
    assert result.status_code==200
    assert client.post(API+'/confirm',json={'action_id':action['action_id']}).status_code==409
    with Session() as db:
        assert db.query(TanggangMockAiReport).count()==0


def test_session_actions_are_attached_to_correct_chat_turn(mock_env):
    client,current,Session=mock_env
    board=ask(client,'帮我生成供水分析看板').json()['data']
    sid=board['session_id']
    report=ask(client,'生成本轮运行复盘',session_id=sid,context=CONTEXT).json()['data']
    detail=client.get(API+'/sessions/'+sid)
    assert detail.status_code==200,detail.text
    messages=[m for m in detail.json()['data']['messages'] if m['role']=='assistant']
    assert len(messages)==2
    assert [a['tool'] for a in messages[0]['pending_actions']]==['create_sim_board']
    assert [a['tool'] for a in messages[1]['pending_actions']]==['create_sim_report']
    assert client.post(API+'/cancel',json={
        'action_id':board['pending_actions'][0]['action_id'],
    }).status_code==200
    assert client.post(API+'/confirm',json={
        'action_id':report['pending_actions'][0]['action_id'],
    }).status_code==200
    detail=client.get(API+'/sessions/'+sid).json()['data']
    messages=[m for m in detail['messages'] if m['role']=='assistant']
    assert messages[0]['pending_actions'][0]['status']=='cancelled'
    assert messages[1]['pending_actions'][0]['status']=='confirmed'
    assert messages[1]['pending_actions'][0]['result_path']=='/port/analysis/reports'


def test_safe_business_navigation_is_read_only_and_restored(mock_env):
    client,current,Session=mock_env
    first=ask(client,'打开大机供水保障')
    assert first.status_code==200,first.text
    data=first.json()['data']
    assert data['links']==[{
        'path':'/port/water/supply','label':'打开大机供水保障',
    }]
    assert not data['pending_actions']
    sid=data['session_id']
    second=ask(client,'进入主动监护',session_id=sid).json()['data']
    assert second['links'][0]['path']=='/port/operations/monitor'
    third=ask(client,'打开运行复盘',session_id=sid).json()['data']
    assert third['links'][0]['path']=='/port/analysis/reports'
    not_allowed=ask(client,'打开恶意网站 http://evil.example',session_id=sid).json()['data']
    assert not not_allowed['links']
    instructions=ask(client,'打开PLC下发指令',session_id=sid).json()['data']
    assert not instructions['links']
    history=client.get(API+'/sessions/'+sid).json()['data']
    rows=[r for r in history['messages'] if r['role']=='assistant']
    assert len(rows)==5
    assert [r['links'][0]['path'] for r in rows[:3]]==[
        '/port/water/supply','/port/operations/monitor','/port/analysis/reports',
    ]
    assert rows[3]['links']==[] and rows[4]['links']==[]
    with Session() as db:
        assert db.query(TanggangBoard).count()==0
        assert db.query(TanggangMockAiReport).count()==0
        assert db.query(Equipment).count()==0
