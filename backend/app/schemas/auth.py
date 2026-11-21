from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    role_code: str
    # 数据范围（角色 sys_role.data_scope）：all=全部 / mine=仅本人，前端据此决定 mine 默认值
    data_scope: str = "all"
    # 按钮权限码列表（menu_type='button' 的 perms 集合；按角色实际授权收集，超管不再通配）
    perms: list[str] = []

    model_config = {"from_attributes": True}


class LoginData(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo
