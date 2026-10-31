import { getAuth } from "@clerk/express";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import {
  db,
  guestSessionsTable,
  notesTable,
  usersTable,
} from "@workspace/db";

export const GUEST_COOKIE = "study_guest";
const guestLifetimeMs = 60 * 24 * 60 * 60 * 1000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StudyOwner =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestSessionId: string };

export function getGuestSessionId(req: {
  signedCookies?: Record<string, string | false>;
}): string | null {
  const guestSessionId = req.signedCookies?.[GUEST_COOKIE];
  return typeof guestSessionId === "string" && uuidPattern.test(guestSessionId)
    ? guestSessionId
    : null;
}

export function getStudyOwner(res: Response): StudyOwner {
  const owner = res.locals.studyOwner as StudyOwner | undefined;
  if (!owner) {
    throw new Error("Study owner middleware was not applied.");
  }
  return owner;
}

export function studyOwnerCondition(owner: StudyOwner): SQL {
  if (owner.kind === "user") {
    return and(
      eq(notesTable.ownerUserId, owner.userId),
      isNull(notesTable.guestSessionId),
    )!;
  }
  return and(
    eq(notesTable.guestSessionId, owner.guestSessionId),
    isNull(notesTable.ownerUserId),
  )!;
}

export function studyOwnerValues(owner: StudyOwner) {
  return owner.kind === "user"
    ? { ownerUserId: owner.userId, guestSessionId: null }
    : { ownerUserId: null, guestSessionId: owner.guestSessionId };
}

export function setGuestCookie(
  res: Response,
  guestSessionId: string,
): void {
  res.cookie(GUEST_COOKIE, guestSessionId, {
    httpOnly: true,
    signed: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: guestLifetimeMs,
    path: "/",
  });
}

export function clearGuestCookie(res: Response): void {
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  res.clearCookie(GUEST_COOKIE, options);
  res.clearCookie(`${GUEST_COOKIE}.sig`, options);
}

export const requireStudyOwner: RequestHandler = async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    if (userId) {
      const [user] = await db
        .select({
          googleProviderId: usersTable.googleProviderId,
          email: usersTable.email,
        })
        .from(usersTable)
        .where(eq(usersTable.clerkUserId, userId))
        .limit(1);
      if (!user?.googleProviderId || !user.email) {
        res.status(403).json({ error: "Use a verified Google account to continue." });
        return;
      }
      res.locals.studyOwner = { kind: "user", userId } satisfies StudyOwner;
      next();
      return;
    }

    const guestSessionId = getGuestSessionId(req);
    if (!guestSessionId) {
      res.status(401).json({ error: "Start a guest session or sign in to continue." });
      return;
    }

    const [guestSession] = await db
      .select({
        id: guestSessionsTable.id,
        transferredToUserId: guestSessionsTable.transferredToUserId,
      })
      .from(guestSessionsTable)
      .where(eq(guestSessionsTable.id, guestSessionId))
      .limit(1);

    if (!guestSession || guestSession.transferredToUserId) {
      res.status(401).json({ error: "This guest session is no longer active." });
      return;
    }

    await db
      .update(guestSessionsTable)
      .set({ lastActiveAt: new Date() })
      .where(eq(guestSessionsTable.id, guestSessionId));

    res.locals.studyOwner = {
      kind: "guest",
      guestSessionId,
    } satisfies StudyOwner;
    next();
  } catch (error) {
    next(error);
  }
};
