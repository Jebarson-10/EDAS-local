/**
 * AuthAdapter (OQ-010 interim): abstract identity resolution.
 * Production must use Cloudflare Access / IdP claims — do not invent mapping.
 *
 * When the client provides an email→role map (OQ-010), set ACCESS_EMAIL_ROLE_MAP
 * as JSON on the Worker / local API env. Until then, Access users default to VIEWER
 * unless an explicit role claim header is present.
 */

export type AppRole = "ADMIN" | "OFFICER" | "DATA_OPERATOR" | "VIEWER";

export interface AuthIdentity {
  userId: string;
  email: string;
  role: AppRole;
  source: "cloudflare-access" | "dev-headers" | "none";
}

export interface AuthResolveOptions {
  /** Lowercased email → role. From ACCESS_EMAIL_ROLE_MAP JSON; empty until OQ-010. */
  emailRoleMap?: Record<string, AppRole>;
  /** Header that may carry a role claim (default X-Access-Role). */
  accessRoleHeader?: string;
}

export interface AuthAdapter {
  resolve(
    request: Request,
    environment: string,
    options?: AuthResolveOptions,
  ): AuthIdentity | null;
}

const ROLES: AppRole[] = ["ADMIN", "OFFICER", "DATA_OPERATOR", "VIEWER"];

function isRole(v: string | null | undefined): v is AppRole {
  return !!v && (ROLES as string[]).includes(v);
}

/** Parse ACCESS_EMAIL_ROLE_MAP JSON; invalid / empty → {}. Never invents entries. */
export function parseEmailRoleMap(
  raw: string | undefined | null,
): Record<string, AppRole> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Record<string, AppRole> = {};
    for (const [email, role] of Object.entries(parsed)) {
      const key = email.trim().toLowerCase();
      if (!key || !isRole(typeof role === "string" ? role : null)) continue;
      out[key] = role as AppRole;
    }
    return out;
  } catch {
    return {};
  }
}

function resolveAccessRole(
  request: Request,
  email: string,
  options?: AuthResolveOptions,
): AppRole {
  const mapped = options?.emailRoleMap?.[email.trim().toLowerCase()];
  if (mapped) return mapped;
  const headerName = options?.accessRoleHeader ?? "X-Access-Role";
  const roleHeader = request.headers.get(headerName);
  if (isRole(roleHeader)) return roleHeader;
  return "VIEWER";
}

/**
 * Default adapter: Access email in staging/production; X-Dev-* only in development.
 * Role mapping is never invented — email map (OQ-010) or optional claim header only.
 */
export class DefaultAuthAdapter implements AuthAdapter {
  resolve(
    request: Request,
    environment: string,
    options?: AuthResolveOptions,
  ): AuthIdentity | null {
    const accessEmail = request.headers.get(
      "Cf-Access-Authenticated-User-Email",
    );
    if (accessEmail) {
      return {
        userId: `access:${accessEmail}`,
        email: accessEmail,
        role: resolveAccessRole(request, accessEmail, options),
        source: "cloudflare-access",
      };
    }
    const env = environment.toLowerCase();
    if (env === "production" || env === "staging") {
      return null;
    }
    const roleHeader = request.headers.get("X-Dev-Role");
    const role: AppRole = isRole(roleHeader) ? roleHeader : "OFFICER";
    const email =
      request.headers.get("X-Dev-Email") ??
      request.headers.get("X-Dev-User") ??
      "officer@example.local";
    return {
      userId: `dev:${email}`,
      email,
      role,
      source: "dev-headers",
    };
  }
}

export const defaultAuthAdapter = new DefaultAuthAdapter();
