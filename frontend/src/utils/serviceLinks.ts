import { CLUSTER_DOMAIN } from '../constants';

export interface ServiceLinks {
  openshiftConsole?: string;
  workshop?: string;
  showroom?: string;
  resourceClaim?: string;
}

export function generateServiceLinks(
  namespace: string,
  guid: string,
  url: string,
  showroomUrl: string
): ServiceLinks {
  const links: ServiceLinks = {};

  // OpenShift console link to namespace
  if (namespace) {
    links.openshiftConsole = `https://console-openshift-console.apps.${CLUSTER_DOMAIN}/k8s/ns/${encodeURIComponent(namespace)}/core~v1~Pod`;
  }

  // Workshop URL (from deployment result)
  if (url && url.startsWith('http')) {
    links.workshop = url;
  }

  // Showroom URL (if available)
  if (showroomUrl && showroomUrl.startsWith('http')) {
    links.showroom = showroomUrl;
  }

  // ResourceClaim CRD link
  if (guid && namespace) {
    links.resourceClaim = `https://console-openshift-console.apps.${CLUSTER_DOMAIN}/k8s/ns/${encodeURIComponent(namespace)}/poolboy.gpte.redhat.com~v1~ResourceClaim/${encodeURIComponent(guid)}`;
  }

  return links;
}
