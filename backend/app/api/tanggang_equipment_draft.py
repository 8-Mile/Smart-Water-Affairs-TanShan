"""Controlled demo equipment intake. No write to eq_equipment, SCADA or CAD."""
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from pydantic_core import PydanticCustomError
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, DbSession, require_perm
from app.core.response import ok
from app.models.equipment import Equipment
from app.models.tanggang_equipment_draft import TanggangDemoEquipment
from app.services.tanggang_catalog import SYSTEMS

router=APIRouter(prefix="/tanggang/demo-equipment",tags=["tanggang-demo-equipment"])

ALIASES={
    "射雾除尘":"fog","射雾系统":"fog","除尘系统":"fog",
    "中压供水":"middle","中压系统":"middle",
    "含矿污水":"mineral","雨水收集":"rain","雨水系统":"rain",
    "水池供水":"pool","水池系统":"pool",
    "生活污水":"domestic",
}

class ParseBody(BaseModel):
    text:str=Field(min_length=5,max_length=500)

class DemoEquipmentBody(BaseModel):
    system_id:str=Field(min_length=2,max_length=32)
    name:str=Field(min_length=2,max_length=128)
    code:str=Field(min_length=2,max_length=64)
    parameters_note:str|None=Field(default=None,max_length=1000)
    request_text:str=Field(min_length=5,max_length=500)
    source_note:str=Field(min_length=6,max_length=512)
    confirmed:bool

    @model_validator(mode="after")
    def validate_demo(self):
        self.name=self.name.strip()
        self.code=self.code.strip()
        self.source_note=self.source_note.strip()
        if self.system_id not in SYSTEMS:
            raise PydanticCustomError("unknown_system","必须指定已登记的唐港六系统")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,63}",self.code):
            raise PydanticCustomError("invalid_code","设备编号只允许英文字母、数字、点、下划线或短横线")
        if not self.confirmed:
            raise PydanticCustomError("unconfirmed","必须人工核对并确认演示登记")
        if not self.source_note:
            raise PydanticCustomError("missing_source","必须注明这是演示假设或引用的上传资料")
        return self


def _out(row:TanggangDemoEquipment):
    return {
        "id":row.id,"system_id":row.system_id,
        "system_name":SYSTEMS[row.system_id],
        "name":row.name,"code":row.code,
        "parameters_note":row.parameters_note,"request_text":row.request_text,
        "source_note":row.source_note,
        "created_by":row.created_by,"created_at":row.created_at,
        "data_mode":"SIM","field_verified":False,
        "in_official_equipment":False,
    }


@router.post("/parse")
def parse_demo(body:ParseBody,_user:CurrentUser):
    text=body.text.strip()
    names=[sid for alias,sid in ALIASES.items() if alias in text]
    # Multiple distinct system names are ambiguous. Fail closed.
    systems=sorted(set(names))
    system_id=systems[0] if len(systems)==1 else None
    # Strict, explainable template extraction, not LLM comprehension.
    name_match=re.search(r"(?:设备名称|设备名|名称)[：:\s]+([^，,；;\n]{2,60})",text)
    code_match=re.search(r"(?:设备编号|编号|编码)[：:\s]+([A-Za-z0-9._-]{2,64})",text)
    params_match=re.search(r"(?:参数)[：:\s]+([^；;\n]{1,150})",text)
    missing=[]
    if not system_id:missing.append("所属六系统")
    if not name_match:missing.append("设备名称")
    if not code_match:missing.append("设备编号")
    return ok({
        "parse_mode":"CONTROLLED_TEMPLATE_NOT_LLM",
        "system_id":system_id,"name":name_match.group(1).strip() if name_match else "",
        "code":code_match.group(1) if code_match else "",
        "parameters_note":params_match.group(1).strip() if params_match else "",
        "missing":missing,"request_text":text,
        "data_mode":"SIM","field_verified":False,
        "source_requirement":"必须人工核对录入参数和来源，不写正式设备台账",
    })


@router.get("")
def list_demo(db:DbSession,user:CurrentUser,page:int=Query(1,ge=1),
              page_size:int=Query(30,ge=1,le=100)):
    q=db.query(TanggangDemoEquipment).filter(TanggangDemoEquipment.created_by==user.id)
    total=q.count()
    rows=q.order_by(TanggangDemoEquipment.id.desc()).offset((page-1)*page_size).limit(page_size).all()
    return ok({"items":[_out(x) for x in rows],"total":total,"page":page,"page_size":page_size})


@router.get("/{demo_id}")
def get_demo(demo_id:int,db:DbSession,user:CurrentUser):
    row=db.query(TanggangDemoEquipment).filter(
        TanggangDemoEquipment.id==demo_id,TanggangDemoEquipment.created_by==user.id,
    ).first()
    if not row:raise HTTPException(status_code=404,detail="演示设备记录不存在")
    return ok(_out(row))


@router.post("")
def confirm_demo(
    body:DemoEquipmentBody,db:DbSession,user:CurrentUser,
    _perm=Depends(require_perm("eq:create")),
):
    # Prevent confusion with existing registered codes even though nothing
    # is written to the official equipment table.
    if db.query(Equipment.id).filter(
        Equipment.code==body.code,Equipment.deleted==0,
    ).first():
        raise HTTPException(status_code=409,detail="编号已用于现有设备台账，请更换演示编号")
    if db.query(TanggangDemoEquipment.id).filter(
        TanggangDemoEquipment.code==body.code,
    ).first():
        raise HTTPException(status_code=409,detail="演示设备编号已存在")
    obj=TanggangDemoEquipment(
        system_id=body.system_id,name=body.name,code=body.code,
        parameters_note=body.parameters_note,request_text=body.request_text,
        source_note=body.source_note,created_by=user.id,
    )
    try:
        db.add(obj);db.commit();db.refresh(obj)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409,detail="演示设备编号已存在") from None
    return ok(_out(obj))
