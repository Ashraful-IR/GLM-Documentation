import { ok, handleError } from "@/lib/http";
import { listLookup } from "@/services/lookup.service";

/**
 * Public: team and designation choices for the registration form. Lives under
 * /api/auth so the proxy lets unauthenticated visitors reach it. Only ids and
 * names are exposed (no user counts).
 */
export async function GET() {
  try {
    const [teams, designations] = await Promise.all([listLookup("team"), listLookup("designation")]);
    const strip = (items: { id: string; name: string }[]) => items.map(({ id, name }) => ({ id, name }));
    return ok({ teams: strip(teams), designations: strip(designations) });
  } catch (err) {
    return handleError(err);
  }
}
