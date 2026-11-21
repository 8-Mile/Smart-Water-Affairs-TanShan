import io

from fastapi.testclient import TestClient

from app.main import app
from app.scada.simulator import scada_runtime


def _login(client: TestClient, password: str = "admin123") -> dict:
    r = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": password},
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def test_archive_upload_download_favorite_and_hardening():
    scada_runtime.stop()
    with TestClient(app) as client:
        h = _login(client)
        scada_runtime.stop()

        cats = client.get("/api/v1/archives/categories", headers=h)
        assert cats.status_code == 200
        assert len(cats.json()["data"]) >= 5

        content = b"%PDF-1.4 mock archive content for test"
        up = client.post(
            "/api/v1/archives/upload",
            headers=h,
            data={
                "name": "测试设备图纸",
                "category_code": "DOC-DRAWING",
                "description": "单元测试上传",
            },
            files={
                "file": ("test_doc.pdf", io.BytesIO(content), "application/pdf"),
            },
        )
        assert up.status_code == 200, up.text
        item = up.json()["data"]
        assert item["name"] == "测试设备图纸"
        archive_id = item["id"]

        stats = client.get("/api/v1/archives/stats", headers=h)
        assert stats.status_code == 200
        assert stats.json()["data"]["total"] >= 1

        fav = client.post(f"/api/v1/archives/{archive_id}/favorite", headers=h)
        assert fav.status_code == 200
        assert fav.json()["data"]["favorited"] is True

        fav_list = client.get(
            "/api/v1/archives",
            headers=h,
            params={"favorite_only": True},
        )
        assert fav_list.status_code == 200
        assert any(x["id"] == archive_id for x in fav_list.json()["data"]["items"])

        dl = client.get(f"/api/v1/archives/{archive_id}/download", headers=h)
        assert dl.status_code == 200
        assert dl.content == content

        health = client.get("/api/v1/health")
        assert health.status_code == 200
        body = health.json()["data"]
        assert body["checks"]["database"]["ok"] is True
        assert body["version"] == "1.0.0"

        logs = client.get("/api/v1/audit/operation-logs", headers=h)
        assert logs.status_code == 200
        assert logs.json()["data"]["total"] >= 1

        # 改密 + 改回，避免影响其他用例
        ch = client.post(
            "/api/v1/auth/change-password",
            headers=h,
            json={"old_password": "admin123", "new_password": "admin1234"},
        )
        assert ch.status_code == 200
        h2 = _login(client, "admin1234")
        client.post(
            "/api/v1/auth/change-password",
            headers=h2,
            json={"old_password": "admin1234", "new_password": "admin123"},
        )
