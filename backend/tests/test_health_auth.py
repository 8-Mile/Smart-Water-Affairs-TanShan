from fastapi.testclient import TestClient

from app.main import app


def test_health():
    with TestClient(app) as client:
        r = client.get("/api/v1/health")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert body["data"]["status"] == "up"


def test_login_and_me():
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "admin123"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        token = body["data"]["access_token"]
        assert token

        me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert me.status_code == 200
        me_body = me.json()
        assert me_body["code"] == 0
        assert me_body["data"]["username"] == "admin"


def test_login_fail():
    with TestClient(app) as client:
        r = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "wrong"},
        )
        assert r.status_code == 401
