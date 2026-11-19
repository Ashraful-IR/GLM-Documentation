import { z } from "zod";

export const emailSchema = z.string().email().max(254);

const roleSchema = z.enum(["ADMIN", "EDITOR", "VIEWER"]);
const passwordSchema = z.string().min(8).max(200);
const nameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  teamId: z.string({ error: "Please select a team" }).uuid({ error: "Please select a team" }),
  designationId: z
    .string({ error: "Please select a designation" })
    .uuid({ error: "Please select a designation" }),
});

/** Admin-created accounts: admin sets the initial password and role; active immediately. */
export const adminCreateUserSchema = registerSchema.extend({
  role: roleSchema.default("VIEWER"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const updateUserSchema = z.object({
  name: nameSchema.optional(),
  role: roleSchema.optional(),
  /** Approve (ACTIVE) or reject (REJECTED) an account. */
  status: z.enum(["ACTIVE", "REJECTED"]).optional(),
  teamId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
});

export const listUsersQuerySchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "REJECTED"]).optional(),
});

/** Team / designation names. */
export const lookupNameSchema = z.object({ name: nameSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
