import { clerkClient, getAuth } from "@clerk/express";
import { and, count, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import {
  GetAuthSessionResponse,
  CreateGuestSessionResponse,
  TransferGuestDataBody,
  TransferGuestDataResponse,
  UpdateOnboardingProgressBody,
  UpdateOnboardingProgressResponse,
} from "@workspace/api-zod";
import {
  db,
  guestSessionsTable,
  notesTable,
  usersTable,
} from "@workspace/db";
import {
  clearGuestCookie,
  getGuestSessionId,
  setGuestCookie,
  type StudyOwner,
} from "../lib/study-owner";

const router: IRouter = Router();
const guestStartLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many guest sessions started. Try again later." },
});

class GoogleAccountRequiredError extends Error {}

async function syncClerkUser(userId: string) {
  const clerkUser = await clerkClient.users.getUser(userId);
  const googleAccount = clerkUser.externalAccounts.find((account) =>
    account.provider.toLowerCase().includes("google"),
  );
  const email = clerkUser.primaryEmailAddress;

  if (!googleAccount || !email || email.verification?.status !== "verified") {
    throw new GoogleAccountRequiredError(
      "Use a verified Google account to access Study with Miky.",
    );
  }

  const name = [clerkUser.firstName, clerkUser.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const [user] = await db
    .insert(usersTable)
    .values({
      clerkUserId: userId,
      googleProviderId: googleAccount.providerUserId,
      email: email.emailAddress,
      name: name || null,
      profileImageUrl: clerkUser.imageUrl || null,
    })
    .onConflictDoUpdate({
      target: usersTable.clerkUserId,
      set: {
        googleProviderId: googleAccount.providerUserId,
        email: email.emailAddress,
        name: name || null,
        profileImageUrl: clerkUser.imageUrl || null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

async function guestProgress(guestSessionId: string) {
  const [session] = await db
    .select({
      id: guestSessionsTable.id,
      onboardingStatus: guestSessionsTable.onboardingStatus,
      onboardingStep: guestSessionsTable.onboardingStep,
      onboardingVersion: guestSessionsTable.onboardingVersion,
      transferredToUserId: guestSessionsTable.transferredToUserId,
    })
    .from(guestSessionsTable)
    .where(eq(guestSessionsTable.id, guestSessionId))
    .limit(1);
  return session?.transferredToUserId ? undefined : session;
}

async function guestNoteCount(guestSessionId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(notesTable)
    .where(
      and(
        eq(notesTable.guestSessionId, guestSessionId),
        isNull(notesTable.ownerUserId),
      ),
    );
  return result.value;
}

function progress(status: string, step: number, version: number) {
  return UpdateOnboardingProgressResponse.parse({ status, step, version });
}

function updateOwnerProgress(
  owner: StudyOwner,
  update: { status: "not_started" | "in_progress" | "completed" | "skipped"; step: number },
) {
  if (owner.kind === "guest") {
    return db
      .update(guestSessionsTable)
      .set({
        onboardingStatus: update.status,
        onboardingStep: update.step,
        lastActiveAt: new Date(),
      })
      .where(eq(guestSessionsTable.id, owner.guestSessionId))
      .returning({
        status: guestSessionsTable.onboardingStatus,
        step: guestSessionsTable.onboardingStep,
        version: guestSessionsTable.onboardingVersion,
      });
  }
  return db
    .update(usersTable)
    .set({
      onboardingStatus: update.status,
      onboardingStep: update.step,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.clerkUserId, owner.userId))
    .returning({
      status: usersTable.onboardingStatus,
      step: usersTable.onboardingStep,
      version: usersTable.onboardingVersion,
    });
}

router.get("/auth/session", async (req, res, next): Promise<void> => {
  try {
    const userId = getAuth(req).userId;
    if (userId) {
      const user = await syncClerkUser(userId);
      const guestSessionId = getGuestSessionId(req);
      const guest = guestSessionId
        ? await guestProgress(guestSessionId)
        : undefined;
      const guestAvailable = guest ? (await guestNoteCount(guest.id)) > 0 : false;
      res.json(
        GetAuthSessionResponse.parse({
          kind: "user",
          guestAvailable,
          user: {
            id: user.clerkUserId,
            email: user.email,
            name: user.name,
            imageUrl: user.profileImageUrl,
          },
          onboarding: progress(
            user.onboardingStatus,
            user.onboardingStep,
            user.onboardingVersion,
          ),
        }),
      );
      return;
    }

    const guestSessionId = getGuestSessionId(req);
    const guest = guestSessionId
      ? await guestProgress(guestSessionId)
      : undefined;
    if (guest) {
      await db
        .update(guestSessionsTable)
        .set({ lastActiveAt: new Date() })
        .where(eq(guestSessionsTable.id, guest.id));
      res.json(
        GetAuthSessionResponse.parse({
          kind: "guest",
          guestAvailable: false,
          onboarding: progress(
            guest.onboardingStatus,
            guest.onboardingStep,
            guest.onboardingVersion,
          ),
        }),
      );
      return;
    }

    res.json(GetAuthSessionResponse.parse({ kind: "anonymous", guestAvailable: false }));
  } catch (error) {
    if (error instanceof GoogleAccountRequiredError) {
      res.status(403).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post(
  "/auth/guest",
  guestStartLimit,
  async (req, res, next): Promise<void> => {
    try {
      if (getAuth(req).userId) {
        res.status(409).json({ error: "Sign out before starting a guest session." });
        return;
      }

      const currentId = getGuestSessionId(req);
      if (currentId) {
        const current = await guestProgress(currentId);
        if (current) {
          await db
            .update(guestSessionsTable)
            .set({ lastActiveAt: new Date() })
            .where(eq(guestSessionsTable.id, current.id));
          res.status(201).json(
            CreateGuestSessionResponse.parse({
              kind: "guest",
              guestAvailable: false,
              onboarding: progress(
                current.onboardingStatus,
                current.onboardingStep,
                current.onboardingVersion,
              ),
            }),
          );
          return;
        }
      }

      const [session] = await db
        .insert(guestSessionsTable)
        .values({})
        .returning();
      setGuestCookie(res, session.id);
      res.status(201).json(
        CreateGuestSessionResponse.parse({
          kind: "guest",
          guestAvailable: false,
          onboarding: progress(
            session.onboardingStatus,
            session.onboardingStep,
            session.onboardingVersion,
          ),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.patch("/auth/onboarding", async (req, res, next): Promise<void> => {
  try {
    const parsed = UpdateOnboardingProgressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = getAuth(req).userId;
    const guestSessionId = getGuestSessionId(req);
    let owner: StudyOwner | undefined;
    if (userId) {
      await syncClerkUser(userId);
      owner = { kind: "user", userId };
    } else if (guestSessionId && (await guestProgress(guestSessionId))) {
      owner = { kind: "guest", guestSessionId };
    }
    if (!owner) {
      res.status(401).json({ error: "Start a guest session or sign in to continue." });
      return;
    }

    const [updated] = await updateOwnerProgress(owner, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "The current session could not be found." });
      return;
    }
    res.json(
      UpdateOnboardingProgressResponse.parse(
        progress(updated.status, updated.step, updated.version),
      ),
    );
  } catch (error) {
    if (error instanceof GoogleAccountRequiredError) {
      res.status(403).json({ error: error.message });
      return;
    }
    next(error);
  }
});

router.post("/auth/guest/transfer", async (req, res, next): Promise<void> => {
  try {
    const parsed = TransferGuestDataBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.confirmed) {
      res.status(400).json({ error: "Confirm the transfer before continuing." });
      return;
    }

    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in before transferring guest notes." });
      return;
    }
    const guestSessionId = getGuestSessionId(req);
    if (!guestSessionId) {
      res.status(401).json({ error: "No active guest session was found." });
      return;
    }

    await syncClerkUser(userId);
    const guest = await guestProgress(guestSessionId);
    if (!guest) {
      res.status(409).json({ error: "This guest session was already transferred." });
      return;
    }

    const movedNotes = await db.transaction(async (tx) => {
      const [activeGuest] = await tx
        .select({ id: guestSessionsTable.id })
        .from(guestSessionsTable)
        .where(
          and(
            eq(guestSessionsTable.id, guestSessionId),
            isNull(guestSessionsTable.transferredToUserId),
          ),
        )
        .for("update");
      if (!activeGuest) {
        return null;
      }
      const moved = await tx
        .update(notesTable)
        .set({ ownerUserId: userId, guestSessionId: null })
        .where(
          and(
            eq(notesTable.guestSessionId, guestSessionId),
            isNull(notesTable.ownerUserId),
          ),
        )
        .returning({ id: notesTable.id });
      await tx
        .update(guestSessionsTable)
        .set({
          transferredToUserId: userId,
          transferredAt: new Date(),
        })
        .where(
          and(
            eq(guestSessionsTable.id, guestSessionId),
            isNull(guestSessionsTable.transferredToUserId),
          ),
        );
      return moved.length;
    });

    if (movedNotes === null) {
      res.status(409).json({ error: "This guest session was already transferred." });
      return;
    }
    clearGuestCookie(res);
    res.json(TransferGuestDataResponse.parse({ movedNotes }));
  } catch (error) {
    if (error instanceof GoogleAccountRequiredError) {
      res.status(403).json({ error: error.message });
      return;
    }
    next(error);
  }
});

export default router;
