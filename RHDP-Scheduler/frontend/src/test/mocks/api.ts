import type {
  HealthResponse,
  WorkshopSchedule,
  DeploymentResult,
  QAResult,
} from '../../types';

export const mockHealthOk: HealthResponse = {
  status: 'ok',
  oc_installed: true,
  oc_connected: true,
  cluster_url: 'https://api.cluster.example.com:6443',
  user: 'admin',
  message: '',
  base_domain: 'apps.cluster.example.com',
  rhdp_api_reachable: true,
};

export const mockHealthError: HealthResponse = {
  status: 'error',
  oc_installed: false,
  oc_connected: false,
  cluster_url: '',
  user: '',
  message: 'oc not found',
  base_domain: '',
  rhdp_api_reachable: false,
};

export const mockSchedule: WorkshopSchedule = {
  ci_name: 'Test Workshop',
  ci: 'vendor.test.prod',
  namespace: 'test-ns',
  users: 20,
  enable_workshop_interface: true,
  password: 'secret',
  activity: 'Training',
  purpose: 'Demo',
  workshop_name: 'test-ws',
  provisioning_date: '15/03/2025 09:00',
  auto_stop: '15/03/2025 17:00',
  auto_destroy: '16/03/2025 09:00',
  is_multi_asset: false,
  asset_cis: '',
  multi_workshop_name: '',
  concurrency: null,
  instances: null,
  salesforce_ids: '',
  salesforce_type: 'opportunity',
  aws_regions: '',
  count: null,
  white_glove: true,
  redirect: true,
  catalog_namespace: 'babylon-catalog-prod',
  showroom_repo: '',
  showroom_ref: '',
  showroom_novnc: false,
  showroom_zerotouch: false,
};

export const mockResult: DeploymentResult = {
  ci_name: 'Test Workshop',
  ci: 'vendor.test.prod',
  namespace: 'test-ns',
  guid: 'abc123',
  url: 'https://example.com/workshop/abc123',
  status: 'verified',
  provisioning_date: '15/03/2025 09:00',
  auto_stop: '15/03/2025 17:00',
  auto_destroy: '16/03/2025 09:00',
  timestamp: '2025-03-15 09:05:00',
  error_message: '',
  showroom_url: '',
  showroom_status: '',
  password: 'secret',
  users: 20,
  instances: 1,
};

export const mockFailedResult: DeploymentResult = {
  ...mockResult,
  ci_name: 'Failed Workshop',
  guid: 'fail123',
  url: '',
  status: 'failed',
  error_message: 'Connection timeout',
};

export const mockQAResult: QAResult = {
  ci_name: 'Test Workshop',
  ci: 'vendor.test.prod',
  namespace: 'test-ns',
  status: 'verified',
  deployed: 'Yes',
  healthy: true,
  expected_users: 20,
  actual_count: 20,
  landing_page_url: 'https://example.com/landing/abc123',
  showroom_status: '',
  showroom_url: '',
};
