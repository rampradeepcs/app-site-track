-- Baseline plans and platform settings so a fresh project is usable at once.
insert into plans (id,name,description,monthly_price,annual_price,currency,trial_days,
  max_employees,max_managers,max_projects,max_storage_gb,route_retention_days,api_calls_per_month,
  features,support_level)
values
 ('plan_starter','Starter','Single-site contractors getting off paper attendance.',7500,75000,'INR',14,
  50,2,5,25,30,0,
  '{"attendance":true,"geofencing":true,"liveTracking":true,"routePlayback":false,"workUpdates":false,"performance":false,"advancedReports":false,"dataExport":false,"apiAccess":false,"customBranding":false,"customDomain":false,"prioritySupport":false}'::jsonb,
  'community'),
 ('plan_growth','Growth','Multi-site builders who need movement history and reporting.',24000,240000,'INR',14,
  250,10,25,150,180,25000,
  '{"attendance":true,"geofencing":true,"liveTracking":true,"routePlayback":true,"workUpdates":true,"performance":true,"advancedReports":true,"dataExport":true,"apiAccess":false,"customBranding":false,"customDomain":false,"prioritySupport":false}'::jsonb,
  'standard'),
 ('plan_enterprise','Enterprise','Large contractors needing custom limits, API and branding.',68000,690000,'INR',30,
  null,null,null,1000,730,500000,
  '{"attendance":true,"geofencing":true,"liveTracking":true,"routePlayback":true,"workUpdates":true,"performance":true,"advancedReports":true,"dataExport":true,"apiAccess":true,"customBranding":true,"customDomain":true,"prioritySupport":true}'::jsonb,
  'priority')
on conflict (id) do nothing;

insert into platform_settings (id, settings) values (1, '{
  "defaultPlanId":"plan_growth","defaultTrialDays":14,"defaultSamplingSeconds":15,
  "defaultRetentionDays":180,"defaultLateGraceMinutes":10,"defaultExitAlertMinutes":10,
  "maintenanceMode":false,"signupsEnabled":true,"globalFeatureFlags":{},
  "supportEmail":"support@sitetrack.app"
}'::jsonb) on conflict (id) do nothing;
