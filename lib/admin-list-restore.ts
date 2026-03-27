const LIST_KEY = "dr-admin-list-state";
const RESTORE_KEY = "dr-admin-should-restore";

export type AdminListPersistedState = {
  page: number;
  searchQuery: string;
  scrollY: number;
};

export function persistAdminListState(state: AdminListPersistedState) {
  try {
    sessionStorage.setItem(LIST_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readAdminListState(): AdminListPersistedState | null {
  try {
    const raw = sessionStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      page: typeof o.page === "number" && o.page >= 1 ? o.page : 1,
      searchQuery: typeof o.searchQuery === "string" ? o.searchQuery : "",
      scrollY: typeof o.scrollY === "number" ? o.scrollY : 0,
    };
  } catch {
    return null;
  }
}

export function markAdminListRestoreOnNextVisit() {
  try {
    sessionStorage.setItem(RESTORE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function shouldRestoreAdminList(): boolean {
  try {
    return sessionStorage.getItem(RESTORE_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearAdminListRestoreIntent() {
  try {
    sessionStorage.removeItem(RESTORE_KEY);
  } catch {
    /* ignore */
  }
}
