from pydantic import BaseModel, EmailStr, constr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=8)

    class Config:
        orm_mode = True


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: constr(min_length=8)
    confirm_password: constr(min_length=8)
