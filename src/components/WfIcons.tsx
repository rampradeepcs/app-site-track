/**
 * SiteTrack icon set — single stroke family (24 grid, 1.9 stroke), so every
 * surface shares one visual language. Decorative by default; pass a `label`
 * when an icon stands alone and must be announced.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; label?: string };

function Icon({
  size = 20,
  label,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      {...rest}
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

export const IHome = (p: IconProps) => (
  <Icon {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></Icon>
);
export const ICalendar = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18" /></Icon>
);
export const IClipboard = (p: IconProps) => (
  <Icon {...p}><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 2.5h6v3H9zM9 11h6M9 15h4" /></Icon>
);
export const IHistory = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 4v4.5H8" /><path d="M12 8v4.5l3 1.8" /></Icon>
);
export const IUser = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="8" r="4" /><path d="M4.5 21c1.3-3.4 4.1-5 7.5-5s6.2 1.6 7.5 5" /></Icon>
);
export const IUsers = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8.5" r="3.5" /><path d="M2.8 20c1.1-3 3.4-4.5 6.2-4.5s5.1 1.5 6.2 4.5" /><path d="M16 5.6a3.5 3.5 0 0 1 0 5.8M18.5 15.9c1.4.7 2.4 2 3 3.8" /></Icon>
);
export const IGrid = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></Icon>
);
export const IBuilding = (p: IconProps) => (
  <Icon {...p}><path d="M4 21V5.5L12 3v18" /><path d="M12 8.5 20 11v10" /><path d="M2.5 21h19" /><path d="M7 8h2M7 12h2M7 16h2M15.5 14h1.5M15.5 17.5h1.5" /></Icon>
);
export const IMapPin = (p: IconProps) => (
  <Icon {...p}><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></Icon>
);
export const IMap = (p: IconProps) => (
  <Icon {...p}><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" /><path d="M9 4v14M15 6v14" /></Icon>
);
export const ICamera = (p: IconProps) => (
  <Icon {...p}><path d="M4 8h3l1.7-2.6h6.6L17 8h3a1.5 1.5 0 0 1 1.5 1.5V19A1.5 1.5 0 0 1 20 20.5H4A1.5 1.5 0 0 1 2.5 19V9.5A1.5 1.5 0 0 1 4 8Z" /><circle cx="12" cy="14" r="3.6" /></Icon>
);
export const IClock = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.2 2" /></Icon>
);
export const INav = (p: IconProps) => (
  <Icon {...p}><path d="m12 2.5 7.5 19-7.5-4.5-7.5 4.5 7.5-19Z" /></Icon>
);
export const ICrosshair = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="7.5" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></Icon>
);
export const IRoute = (p: IconProps) => (
  <Icon {...p}><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.4 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.1" strokeDasharray="0.1 3.4" /></Icon>
);
export const IPlay = (p: IconProps) => (
  <Icon {...p}><path d="M7 4.8v14.4L19 12 7 4.8Z" fill="currentColor" stroke="none" /></Icon>
);
export const IPause = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" /></Icon>
);
export const IBell = (p: IconProps) => (
  <Icon {...p}><path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.6 2.3 6.5H3.7C4.5 15.1 6 13.5 6 9.5Z" /><path d="M10 19.5a2.2 2.2 0 0 0 4 0" /></Icon>
);
export const ICheck = (p: IconProps) => (
  <Icon {...p}><path d="m4.5 12.5 5 5L19.5 7" /></Icon>
);
export const ICheckCircle = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.7 2.7 5-5.5" /></Icon>
);
export const IX = (p: IconProps) => (
  <Icon {...p}><path d="M5.5 5.5l13 13M18.5 5.5l-13 13" /></Icon>
);
export const IAlert = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.5 22 20H2L12 3.5Z" /><path d="M12 10v4.2M12 17.3v.2" /></Icon>
);
export const IInfo = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.8v.2" /></Icon>
);
export const IChevronR = (p: IconProps) => (
  <Icon {...p}><path d="m9 5 7 7-7 7" /></Icon>
);
export const IChevronL = (p: IconProps) => (
  <Icon {...p}><path d="m15 5-7 7 7 7" /></Icon>
);
export const IChevronD = (p: IconProps) => (
  <Icon {...p}><path d="m5 9 7 7 7-7" /></Icon>
);
export const IPlus = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const IMinus = (p: IconProps) => (
  <Icon {...p}><path d="M5 12h14" /></Icon>
);
export const ISearch = (p: IconProps) => (
  <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.4-4.4" /></Icon>
);
export const IFilter = (p: IconProps) => (
  <Icon {...p}><path d="M3.5 5h17l-6.5 8v6l-4 2v-8L3.5 5Z" /></Icon>
);
export const IDownload = (p: IconProps) => (
  <Icon {...p}><path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 19.5h15" /></Icon>
);
export const ILogout = (p: IconProps) => (
  <Icon {...p}><path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14" /><path d="m16 8 4 4-4 4M20 12H9.5" /></Icon>
);
export const ISettings = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8 13.7 5a7.6 7.6 0 0 1 2.4 1l2.7-.7 1.7 3-1.9 2a7.6 7.6 0 0 1 0 2.7l1.9 2-1.7 3-2.7-.7a7.6 7.6 0 0 1-2.4 1L12 21.2 10.3 19a7.6 7.6 0 0 1-2.4-1l-2.7.7-1.7-3 1.9-2a7.6 7.6 0 0 1 0-2.7l-1.9-2 1.7-3 2.7.7a7.6 7.6 0 0 1 2.4-1L12 2.8Z" /></Icon>
);
export const IPhone = (p: IconProps) => (
  <Icon {...p}><path d="M5.5 3.5h4l1.5 4.5-2.2 1.7a13.5 13.5 0 0 0 5.5 5.5l1.7-2.2 4.5 1.5v4a1.8 1.8 0 0 1-2 1.8C10.5 19.6 4.4 13.5 3.7 5.5a1.8 1.8 0 0 1 1.8-2Z" /></Icon>
);
export const IShield = (p: IconProps) => (
  <Icon {...p}><path d="M12 2.8 20 6v6c0 5-3.3 8-8 9.2C7.3 20 4 17 4 12V6l8-3.2Z" /><path d="m8.7 11.8 2.4 2.4 4.2-4.6" /></Icon>
);
export const IWifiOff = (p: IconProps) => (
  <Icon {...p}><path d="M2 8.5A15 15 0 0 1 8.4 5M12 4.5c3.7 0 7.1 1.5 10 4M5.5 12a10 10 0 0 1 4-2.4M12 9.5c2.6 0 5 1 7 2.9M8.8 15.5a5.5 5.5 0 0 1 6.4 0" /><path d="M12 19.5v.2" /><path d="m3 3 18 18" /></Icon>
);
export const IWifi = (p: IconProps) => (
  <Icon {...p}><path d="M2 8.5c5.8-5.3 14.2-5.3 20 0M5.5 12a9.7 9.7 0 0 1 13 0M8.8 15.5a5.5 5.5 0 0 1 6.4 0M12 19.5v.2" /></Icon>
);
export const IBattery = (p: IconProps) => (
  <Icon {...p}><rect x="2.5" y="8" width="17" height="8.5" rx="2" /><path d="M22 11v2.5" /><path d="M6 10.5v3.5M9.5 10.5v3.5M13 10.5v3.5" /></Icon>
);
export const ITrend = (p: IconProps) => (
  <Icon {...p}><path d="m3.5 16.5 5-5.5 3.8 3.5 7.7-8" /><path d="M15.5 6.5H20V11" /></Icon>
);
export const IChart = (p: IconProps) => (
  <Icon {...p}><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8.5 16v-5M13 16V7.5M17.5 16v-3" /></Icon>
);
export const IFile = (p: IconProps) => (
  <Icon {...p}><path d="M6 3.5h8L19 8.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5a1.5 1.5 0 0 1 1-1.4Z" /><path d="M14 3.5V9h5" /></Icon>
);
export const IEdit = (p: IconProps) => (
  <Icon {...p}><path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20Z" /><path d="m14.5 7 3 3" /></Icon>
);
export const ITrash = (p: IconProps) => (
  <Icon {...p}><path d="M4.5 6.5h15M9.5 3.5h5M7 6.5 8 20.5h8l1-14" /><path d="M10.2 10v7M13.8 10v7" /></Icon>
);
export const IHardHat = (p: IconProps) => (
  <Icon {...p}><path d="M4 16a8 8 0 0 1 5-7.4V12M15 12V8.6A8 8 0 0 1 20 16" /><path d="M9 8.5V6.8A1.8 1.8 0 0 1 10.8 5h2.4A1.8 1.8 0 0 1 15 6.8v1.7" /><path d="M2.5 16.5A1.5 1.5 0 0 1 4 15h16a1.5 1.5 0 0 1 1.5 1.5v.5c0 1-1 2-2.2 2H4.7c-1.2 0-2.2-1-2.2-2v-.5Z" /></Icon>
);
export const IZap = (p: IconProps) => (
  <Icon {...p}><path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12l1-8Z" /></Icon>
);
export const ILayers = (p: IconProps) => (
  <Icon {...p}><path d="m12 3 9.5 5L12 13 2.5 8 12 3Z" /><path d="m4 12-1.5 1L12 18l9.5-5L20 12" /></Icon>
);
export const ITarget = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.8" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></Icon>
);
export const IMic = (p: IconProps) => (
  <Icon {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" /></Icon>
);
export const IImage = (p: IconProps) => (
  <Icon {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m6 19 5.5-5.5 3 3L18 13l2.5 2.5" /></Icon>
);
export const IRefresh = (p: IconProps) => (
  <Icon {...p}><path d="M20 11.5A8 8 0 0 0 6.3 6.7L4 9M4 12.5a8 8 0 0 0 13.7 4.8L20 15" /><path d="M4 4.5V9h4.5M20 19.5V15h-4.5" /></Icon>
);
export const IEye = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Icon>
);
export const IArrowR = (p: IconProps) => (
  <Icon {...p}><path d="M4 12h15M13.5 6l6 6-6 6" /></Icon>
);
export const IStop = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></Icon>
);
export const ISatellite = (p: IconProps) => (
  <Icon {...p}><path d="m9 7.5 7.5 7.5M13 3.5 20.5 11l-3.2 3.2-7.5-7.5L13 3.5Z" /><path d="m6.8 9.7-3.3 3.2L11 20.5l3.2-3.3" /><path d="M8.5 19.5c-2.2.6-4-.1-4-.1s-.7-1.8-.1-4" /></Icon>
);

export const ILock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="10.5" width="16" height="10" rx="2.2" />
    <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    <circle cx="12" cy="15.4" r="1.3" />
  </Icon>
);
