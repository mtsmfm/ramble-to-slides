/**
 * Small typed shims for the parts of the File System Access API that lib.dom
 * does not declare (showDirectoryPicker, queryPermission/requestPermission).
 */
import { t } from "../i18n";

export interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | string;
}

type DirectoryPicker = (opts?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;

interface PermissionDescriptorFSA {
  mode?: "read" | "readwrite";
}

interface HandleWithPermissions {
  queryPermission?(desc?: PermissionDescriptorFSA): Promise<PermissionState>;
  requestPermission?(desc?: PermissionDescriptorFSA): Promise<PermissionState>;
}

function picker(): DirectoryPicker | null {
  const fn = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof fn === "function" ? (fn.bind(window) as DirectoryPicker) : null;
}

/** True when this browser can let us write into a directory the user picks. */
export function fileSystemAccessAvailable(): boolean {
  return picker() !== null && window.isSecureContext;
}

/** Localized explanation of why the API is missing. */
export function unavailableReason(): string {
  return window.isSecureContext ? t("store.unsupported") : t("store.insecure");
}

export async function showDirectoryPicker(opts: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle> {
  const fn = picker();
  if (!fn) throw new Error(unavailableReason());
  return fn(opts);
}

/** "granted" / "denied" / "prompt"; falls back to "granted" on browsers without the method. */
export async function queryPermission(
  handle: FileSystemHandle,
  mode: "read" | "readwrite",
): Promise<PermissionState> {
  const h = handle as unknown as HandleWithPermissions;
  if (typeof h.queryPermission !== "function") return "granted";
  try {
    return await h.queryPermission({ mode });
  } catch {
    return "prompt";
  }
}

/** Must be called from a user gesture. */
export async function requestPermission(
  handle: FileSystemHandle,
  mode: "read" | "readwrite",
): Promise<PermissionState> {
  const h = handle as unknown as HandleWithPermissions;
  if (typeof h.requestPermission !== "function") return "granted";
  try {
    return await h.requestPermission({ mode });
  } catch {
    return "denied";
  }
}
