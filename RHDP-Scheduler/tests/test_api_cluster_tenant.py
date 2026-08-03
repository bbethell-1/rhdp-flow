"""API endpoint tests for cluster-tenant validation."""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from api.server import app


client = TestClient(app)


@pytest.fixture
def sample_csv_with_tenant():
    """CSV with both cluster and tenant variants."""
    base_time = datetime.now()
    cluster_time = base_time.strftime("%d/%m/%Y %H:%M")
    tenant_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")
    stop_time = (base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")
    destroy_time = (base_time + timedelta(days=1)).strftime("%d/%m/%Y %H:%M")

    return f"""CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Cluster Workshop,workshop.prod,user-test,10,True,test123,Admin,QA,Test Workshop,{cluster_time},{stop_time},{destroy_time}
Tenant Workshop,workshop.prod-tenant,user-test,10,True,test123,Admin,QA,Test Workshop Tenant,{tenant_time},{stop_time},{destroy_time}
"""


@pytest.fixture
def sample_csv_tenant_before_cluster():
    """CSV with tenant scheduled before cluster (error case)."""
    base_time = datetime.now()
    tenant_time = base_time.strftime("%d/%m/%Y %H:%M")
    cluster_time = (base_time + timedelta(hours=1)).strftime("%d/%m/%Y %H:%M")
    stop_time = (base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")
    destroy_time = (base_time + timedelta(days=1)).strftime("%d/%m/%Y %H:%M")

    return f"""CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Cluster Workshop,workshop.prod,user-test,10,True,test123,Admin,QA,Test Workshop,{cluster_time},{stop_time},{destroy_time}
Tenant Workshop,workshop.prod-tenant,user-test,10,True,test123,Admin,QA,Test Workshop Tenant,{tenant_time},{stop_time},{destroy_time}
"""


def test_validate_cluster_tenant_no_schedules():
    """Endpoint returns 400 when no schedules loaded."""
    # Clear any existing schedules
    client.post("/api/sessions/clear")

    response = client.post("/api/schedules/validate-cluster-tenant")
    assert response.status_code == 400
    assert "No schedules loaded" in response.json()["detail"]


def test_validate_cluster_tenant_valid_ordering(sample_csv_with_tenant):
    """Valid ordering: cluster before tenant → no errors."""
    client.post("/api/sessions/clear")

    # Upload CSV
    files = {"file": ("test.csv", sample_csv_with_tenant, "text/csv")}
    upload_response = client.post("/api/schedules/upload", files=files)
    assert upload_response.status_code == 200

    # Validate cluster-tenant ordering
    response = client.post("/api/schedules/validate-cluster-tenant")
    assert response.status_code == 200

    data = response.json()
    assert data["errors"] == []
    assert data["warnings"] == []
    assert data["tenants_checked"] == 1
    assert data["clusters_found"] == 1


def test_validate_cluster_tenant_invalid_ordering(sample_csv_tenant_before_cluster):
    """Invalid ordering: tenant before cluster → error."""
    client.post("/api/sessions/clear")

    # Upload CSV
    files = {"file": ("test.csv", sample_csv_tenant_before_cluster, "text/csv")}
    upload_response = client.post("/api/schedules/upload", files=files)
    assert upload_response.status_code == 200

    # Validate cluster-tenant ordering
    response = client.post("/api/schedules/validate-cluster-tenant")
    assert response.status_code == 200

    data = response.json()
    assert len(data["errors"]) == 1
    assert data["errors"][0]["tenant_ci"] == "workshop.prod-tenant"
    assert data["errors"][0]["cluster_ci"] == "workshop.prod"
    assert "Deploy cluster first" in data["errors"][0]["message"]
    assert data["warnings"] == []
    assert data["tenants_checked"] == 1
    assert data["clusters_found"] == 1


def test_validate_cluster_tenant_no_cluster():
    """Tenant without cluster → warning."""
    base_time = datetime.now()
    tenant_time = base_time.strftime("%d/%m/%Y %H:%M")
    stop_time = (base_time + timedelta(hours=2)).strftime("%d/%m/%Y %H:%M")
    destroy_time = (base_time + timedelta(days=1)).strftime("%d/%m/%Y %H:%M")

    csv_content = f"""CI Name,CI,Namespace,Users,Enable_workshop_interface,Password,Activity,Purpose,Workshop Name,Provisioning Date (UTC),Auto-stop (UTC),Auto-destroy (UTC)
Tenant Workshop,workshop.prod-tenant,user-test,10,True,test123,Admin,QA,Test Workshop Tenant,{tenant_time},{stop_time},{destroy_time}
"""

    client.post("/api/sessions/clear")

    # Upload CSV
    files = {"file": ("test.csv", csv_content, "text/csv")}
    upload_response = client.post("/api/schedules/upload", files=files)
    assert upload_response.status_code == 200

    # Validate cluster-tenant ordering
    response = client.post("/api/schedules/validate-cluster-tenant")
    assert response.status_code == 200

    data = response.json()
    assert data["errors"] == []
    assert len(data["warnings"]) == 1
    assert data["warnings"][0]["tenant_ci"] == "workshop.prod-tenant"
    assert "workshop.prod" in data["warnings"][0]["message"]
    assert data["tenants_checked"] == 1
    assert data["clusters_found"] == 0
