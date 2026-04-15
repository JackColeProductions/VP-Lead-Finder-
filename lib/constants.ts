/**
 * LeadFlow runs as a single-user local tool with no auth. Every backend
 * route, edge function, and pipeline step references this one user id.
 *
 * The matching row is seeded in supabase/migrations/0002_seed_default_user.sql.
 */
export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001";
