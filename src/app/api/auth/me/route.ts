import { ok, handleError } from "@/lib/http";
import { getSessionUser } from "@/lib/auth/actor";
import { getProfileNames } from "@/services/user.service";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok(null);
    const { teamName, designationName } = await getProfileNames(user);
    return ok({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      teamName,
      designationName,
    });
  } catch (err) {
    return handleError(err);
  }
}
