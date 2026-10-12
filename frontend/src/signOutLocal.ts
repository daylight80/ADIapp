// Logging out on one device must not log the account out everywhere.
//
// supabase-js signOut() defaults to scope 'global', which revokes the user's sessions on
// EVERY device. So pressing Logout on the phone (or the phone's fingerprint check failing,
// which signs out) left a web tab holding a login whose session no longer existed on the
// server: its token still looked valid, so pages half-worked, with backend calls failing
// "session_not_found" and loads that stalled. 'local' ends only this device's session.

type SignOutClient = { auth: { signOut: (opts?: { scope?: 'global' | 'local' | 'others' }) => Promise<unknown> } };

export async function signOutThisDevice(client: SignOutClient): Promise<void> {
  await client.auth.signOut({ scope: 'local' });
}
