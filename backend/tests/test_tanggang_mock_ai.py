"""M5 MOCK assistant end-to-end; never touch live operational tables."""
import json
from datetime import datetime,timedelta

import pytest

from test_tanggang_a2ui_boards import env
from app.core.config import get_settings
from app.models.tanggang_board import TanggangBoard, TanggangBoardRevision
from app.models.tanggang_equipment_draft import TanggangDemoEquipment
from app.models.tanggang_mock_ai import TanggangMockAiSession,TanggangMockAiAction,TanggangMockAiMessage
from app.models.equipment import Equipment
from app.models.ai_audit import AiAuditLog

PREFIX='/api/v1/ai'

@pytest.fixture
def mock_env(env,monkeypatch):
    monkeypatch.setattr(get_settings(),'ai_mock_enabled',True)
    monkeypatch.setattr(get_settings(),'ai_enabled',False)
    monkeypatch.setattr(get_settings(),'app_env','dev')
    return env


def ask(client,message,session_id=None,context=None):
    return client.post(PREFIX+'/chat',json={
        'message':message,'session_id':session_id,'enable_tools':True,
        **({'demo_context':context} if context else {}),
    })


def test_mock_health_without_real_llm_and_production_guard(mock_env,monkeypatch):
    client,current,db=mock_env
    r=client.get(PREFIX+'/health')
    assert r.status_code==200,r.text
    data=r.json()['data']
    assert data['mock'] is True and data['mode']=='MOCK' and data['data_mode']=='SIM'
    assert data['ok'] is True and '规则' in data['chat_model']
    monkeypatch.setattr(get_settings(),'app_env','prod')
    r=client.get(PREFIX+'/health')
    assert r.status_code==503, r.text
    monkeypatch.setattr(get_settings(),'app_env','dev')


def test_sim_snapshot_is_explicit_unverified_client_context(mock_env):
    client,current,Session=mock_env
    context={'data_mode':'SIM','field_verified':False,
      'scenario_id':'peak','run_number':2,'demand_m3h':139,
      'delivered_m3h':105,'shortage_m3h':34,
      'coverage_percent':75.5,'pool_forecast_m3':350,
      'monitor_risk':'attention','triggered_rules':['运行时高电流']}
    r=ask(client,'当前模拟供水缺口是多少？',context=context)
    assert r.status_code==200,r.text
    reply=r.json()['data']['reply']
    assert '34' in reply and '139' in reply
    assert 'SIM' in reply and '不' in reply
    assert '运行时高电流' in reply
    invalid=ask(client,'当前供水',context={**context,'field_verified':True})
    assert invalid.status_code==422
    invalid=ask(client,'当前供水',context={**context,'data_mode':'MEASURED'})
    assert invalid.status_code==422
    invalid=ask(client,'当前供水',context={**context,'shortage_m3h':-1})
    assert invalid.status_code==422
    no_data=ask(client,'当前模拟供水缺口')
    assert no_data.status_code==200
    assert '尚未提供SIM' in no_data.json()['data']['reply']
    assert '预置MOCK样例' in no_data.json()['data']['reply']
    assert '34 m³/h' in no_data.json()['data']['reply']
    with Session() as db:
        assert db.query(Equipment).count()==0
        assert db.query(TanggangDemoEquipment).count()==0


def test_sse_pending_device_confirmation_and_no_real_equipment(mock_env):
    client,current,Session=mock_env
    current['name']='publisher'
    instruction='在除尘系统新增设备，设备名称：演示喷雾泵，设备编号：SIM-AI-001，参数：待核实'
    stream=client.post(PREFIX+'/chat/stream',json={'message':instruction})
    assert stream.status_code==200,stream.text
    events=[json.loads(line[5:].strip()) for line in stream.text.splitlines() if line.startswith('data:')]
    assert events[0]['type']=='session'
    assert any(e['type']=='token' for e in events)
    pending=[e['action'] for e in events if e['type']=='pending']
    assert len(pending)==1
    assert pending[0]['tool']=='create_demo_equipment'
    assert pending[0]['payload']['source_note'].startswith('SIM')
    assert events[-1]['mock'] is True
    with Session() as db:
        assert db.query(TanggangMockAiAction).count()==1
        assert db.query(TanggangDemoEquipment).count()==0
        assert db.query(Equipment).count()==0
    act_id=pending[0]['action_id']
    confirmed=client.post(PREFIX+'/confirm',json={'action_id':act_id})
    assert confirmed.status_code==200,confirmed.text
    item=confirmed.json()['data']['result']
    assert item['path']=='/port/analysis/equipment-drafts'
    assert item['in_official_equipment'] is False
    assert client.post(PREFIX+'/confirm',json={'action_id':act_id}).status_code==409
    assert client.post(PREFIX+'/cancel',json={'action_id':act_id}).status_code==409
    with Session() as db:
        assert db.query(TanggangDemoEquipment).count()==1
        assert db.query(Equipment).count()==0
        audit=db.query(AiAuditLog).all()
        assert len(audit)==1 and audit[0].status=='confirmed'
    history=client.get(PREFIX+'/sessions')
    assert history.status_code==200 and len(history.json()['data'])==1
    d=client.get(PREFIX+'/sessions/'+events[0]['session_id'])
    assert d.status_code==200
    assert len(d.json()['data']['messages'])==2
    assert d.json()['data']['pending_actions'][0]['status']=='confirmed'
    current['name']='other'
    assert client.get(PREFIX+'/sessions/'+events[0]['session_id']).status_code==404
    assert client.post(PREFIX+'/confirm',json={'action_id':act_id}).status_code==404


def test_mock_draft_board_created_only_after_confirm_and_cancellable(mock_env):
    client,current,Session=mock_env
    body=ask(client,'帮我生成供水分析看板')
    assert body.status_code==200,body.text
    data=body.json()['data']
    pending=data['pending_actions']
    assert len(pending)==1 and pending[0]['tool']=='create_sim_board'
    assert pending[0]['payload']['target_path']=='/port/water/supply'
    with Session() as db:
        assert db.query(TanggangBoard).count()==0
    action_id=pending[0]['action_id']
    confirmed=client.post(PREFIX+'/confirm',json={'action_id':action_id})
    assert confirmed.status_code==200,confirmed.text
    result=confirmed.json()['data']['result']
    assert result['status']=='draft' and result['path']=='/port/analysis/boards'
    assert client.post(PREFIX+'/confirm',json={'action_id':action_id}).status_code==409
    with Session() as db:
        b=db.query(TanggangBoard).one()
        assert b.status=='draft' and b.target_path=='/port/water/supply'
        assert db.query(TanggangBoardRevision).count()==1
        assert db.query(Equipment).count()==0
    next_action=ask(client,'帮我生成监护看板').json()['data']['pending_actions'][0]
    canceled=client.post(PREFIX+'/cancel',json={'action_id':next_action['action_id']})
    assert canceled.status_code==200,canceled.text
    assert client.post(PREFIX+'/confirm',json={'action_id':next_action['action_id']}).status_code==409
    with Session() as db:
        assert db.query(TanggangBoard).count()==1
        assert [x.status for x in db.query(AiAuditLog).order_by(AiAuditLog.id.asc()).all()]==['confirmed','cancelled']


def test_missing_fields_permission_and_mutating_commands_blocked(mock_env):
    client,current,Session=mock_env
    incomplete=ask(client,'在除尘系统新增设备xx号，参数待定')
    assert incomplete.status_code==200
    assert not incomplete.json()['data']['pending_actions']
    invalid=ask(client,'请启动1号泵，并下发PLC指令')
    assert invalid.status_code==200
    assert invalid.json()['data']['pending_actions']==[]
    assert '不执行' in invalid.json()['data']['reply']
    instr='在除尘系统新增设备，设备名称：演示测试泵，设备编号：SIM-AI-002'
    pending=ask(client,instr).json()['data']['pending_actions'][0]
    denied=client.post(PREFIX+'/confirm',json={'action_id':pending['action_id']})
    assert denied.status_code==403,denied.text
    with Session() as db:
        assert db.query(TanggangDemoEquipment).count()==0
        assert db.query(Equipment).count()==0
        assert db.get(TanggangMockAiAction,pending['action_id']).status=='pending'


def test_expired_action_refused_with_no_writes(mock_env):
    client,current,Session=mock_env
    current['name']='publisher'
    act=ask(client,'帮我生成监护分析看板').json()['data']['pending_actions'][0]
    with Session() as db:
        row=db.get(TanggangMockAiAction,act['action_id'])
        row.created_at=datetime.utcnow()-timedelta(hours=1)
        db.commit()
    r=client.post(PREFIX+'/confirm',json={'action_id':act['action_id']})
    assert r.status_code==410,r.text
    with Session() as db:
        assert db.query(TanggangBoard).count()==0


def test_mock_demo_equipment_query_respects_user_scope(mock_env):
    client,current,Session=mock_env
    current['name']='publisher'
    instruction='在除尘系统新增设备，设备名称：演示循环泵，设备编号：SIM-AI-003'
    action=ask(client,instruction).json()['data']['pending_actions'][0]
    client.post(PREFIX+'/confirm',json={'action_id':action['action_id']})
    found=ask(client,'查询演示设备')
    assert found.status_code==200
    assert 'SIM-AI-003' in found.json()['data']['reply']
    current['name']='reader'
    empty=ask(client,'查询演示设备')
    assert '尚未登记' in empty.json()['data']['reply']


def test_legacy_real_ai_proxy_mode_unchanged(env,monkeypatch):
    from unittest.mock import patch
    client,current,Session=env
    monkeypatch.setattr(get_settings(),'app_env','dev')
    monkeypatch.setattr(get_settings(),'ai_mock_enabled',False)
    monkeypatch.setattr(get_settings(),'ai_enabled',True)
    with (
        patch('app.api.ai.ai_service_client.health',
              return_value={'ok':True,'data':{'chat_model':'local-qwen-real-test'}}),
        patch('app.api.ai.ai_service_client.chat',
              return_value={'session_id':'real-session','reply':'测试真实AI代理通道',
                            'model':'local-qwen-real-test','tool_trace':[]}),
    ):
        h=client.get(PREFIX+'/health')
        assert h.status_code==200,h.text
        assert h.json()['data']['ok'] is True
        assert not h.json()['data'].get('mock')
        reply=ask(client,'你好')
        assert reply.status_code==200,reply.text
        assert reply.json()['data']['model']=='local-qwen-real-test'
        assert reply.json()['data']['session_id']=='real-session'
    with Session() as db:
        assert db.query(TanggangMockAiSession).count()==0


def test_mock_explicitly_off_and_real_ai_off_returns_503(env,monkeypatch):
    client,current,Session=env
    monkeypatch.setattr(get_settings(),'ai_mock_enabled',False)
    monkeypatch.setattr(get_settings(),'ai_enabled',False)
    h=client.get(PREFIX+'/health')
    assert h.status_code==503,h.text
    assert ask(client,'你好').status_code==503
