import fs from "fs";
import path from "path";
import { SimplePool, UnsignedEvent, finalizeEvent } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { parseConfigArgs } from "./args";
import { loadCliProfile, writeJsonFile } from "./config";
import { loadWriteSecretKey } from "../infra/filesystem/writeSupport";
import {
  SavedWorkspaceDocument,
  saveEditedWorkspaceDocuments,
} from "../infra/filesystem/workspaceSave";
import {
  PUBLISH_TIMEOUT,
  TIMEOUT_REASON,
  errorMessage,
  publishStatuses,
  statusOf,
} from "../infra/nostr/nostrPublish";
import { buildDepositEvent } from "../nodesDocumentEvent";
import { newTimestamp } from "../nostr";

type Receipts = Record<string, Record<string, string>>;

type Deposit = {
  docId: string;
  relativePath: string;
  event: UnsignedEvent;
  fingerprint: string;
};

export type Rejection = {
  path: string;
  relay: string;
  reason: string;
};

type Outcome = {
  deposit: Deposit;
  accepted: string[];
  rejected: Rejection[];
};

export function publishHelp(): string {
  return [
    "Usage: knowstr publish [--config <path>]",
    "",
    "Saves the workspace, then publishes each document as a deposit to",
    "every room relay that has not accepted its current content and tags.",
    "Documents with save warnings are not published.",
    "Acceptances are kept per relay in published.json next to profile.json.",
    "A relay that cannot be reached or times out is left out for the rest",
    "of the run; its documents are retried on the next run.",
    "accepted_paths lists documents accepted by at least one relay in this",
    "run, unaccepted_paths those no relay holds afterwards (exit code 1).",
  ].join("\n");
}

function report(line: string): void {
  process.stderr.write(`${line}\n`);
}

function fingerprintOf(event: UnsignedEvent): string {
  return bytesToHex(
    sha256(
      JSON.stringify([
        event.kind,
        event.pubkey,
        event.tags.filter((tag) => tag[0] !== "ms"),
        event.content,
      ])
    )
  );
}

function isRecordOf<T>(
  value: unknown,
  isEntry: (entry: unknown) => entry is T
): value is Record<string, T> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isEntry)
  );
}

function isFingerprint(entry: unknown): entry is string {
  return typeof entry === "string";
}

function isDocumentRecord(entry: unknown): entry is Record<string, string> {
  return isRecordOf(entry, isFingerprint);
}

function readReceipts(filePath: string): Receipts {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecordOf(parsed, isDocumentRecord)) {
    throw new Error(
      `${filePath} must map relay urls to document ids and fingerprints`
    );
  }
  return parsed;
}

function depositFor(
  saved: SavedWorkspaceDocument,
  pubkey: PublicKey,
  createdAt: number
): Deposit {
  const event = buildDepositEvent(
    saved.document,
    pubkey,
    saved.content,
    createdAt
  );
  return {
    docId: saved.document.docId,
    relativePath: saved.document.relativePath,
    event,
    fingerprint: fingerprintOf(event),
  };
}

function pendingRelays(
  receipts: Receipts,
  relayUrls: string[],
  deposit: Deposit
): string[] {
  return relayUrls.filter(
    (url) => receipts[url]?.[deposit.docId] !== deposit.fingerprint
  );
}

async function connectRelays(
  pool: Pick<SimplePool, "ensureRelay">,
  relayUrls: string[]
): Promise<Record<string, PublishStatus>> {
  const attempts = await Promise.allSettled(
    relayUrls.map((url) => pool.ensureRelay(url))
  );
  attempts.forEach((attempt, index) => {
    const url = relayUrls[index];
    if (attempt.status === "fulfilled") {
      const relay = attempt.value;
      // eslint-disable-next-line functional/immutable-data
      relay.onnotice = (message) => report(`${url}: ${message}`);
    } else {
      report(
        `${url}: ${errorMessage(attempt.reason)}. Leaving it out for this run.`
      );
    }
  });
  return Object.fromEntries(
    relayUrls.map((url, index) => [url, statusOf(attempts[index])])
  );
}

function outcomeOf(
  deposit: Deposit,
  statuses: Array<[string, PublishStatus]>,
  workspaceDir: string
): Outcome {
  return {
    deposit,
    accepted: statuses
      .filter(([, status]) => status.status === "fulfilled")
      .map(([relay]) => relay),
    rejected: statuses
      .filter(([, status]) => status.status === "rejected")
      .map(([relay, status]) => ({
        path: path.join(workspaceDir, deposit.relativePath),
        relay,
        reason: status.reason ?? "rejected",
      })),
  };
}

function progressLine(index: number, total: number, outcome: Outcome): string {
  const targets = outcome.accepted.length + outcome.rejected.length;
  return [
    `[${index}/${total}] ${outcome.deposit.relativePath}  ${outcome.accepted.length}/${targets} relays`,
    ...outcome.rejected.map(({ relay, reason }) => `${relay}: ${reason}`),
  ].join("  ");
}

/* eslint-disable functional/immutable-data, no-await-in-loop, no-param-reassign */
async function publishPending(
  pending: Deposit[],
  receipts: Receipts,
  run: {
    relayUrls: string[];
    secretKey: Uint8Array;
    pool: Pick<SimplePool, "ensureRelay" | "publish">;
    publishedPath: string;
    workspaceDir: string;
  }
): Promise<Outcome[]> {
  const health = await connectRelays(run.pool, run.relayUrls);
  const outcomes: Outcome[] = [];
  for (const deposit of pending) {
    const targets = pendingRelays(receipts, run.relayUrls, deposit);
    const attempted = await publishStatuses(
      run.pool,
      finalizeEvent(deposit.event, run.secretKey),
      targets.filter((url) => health[url].status === "fulfilled"),
      PUBLISH_TIMEOUT
    );
    const skipped = targets
      .filter((url) => health[url].status === "rejected")
      .map((url): [string, PublishStatus] => [url, health[url]]);
    const outcome = outcomeOf(
      deposit,
      [...attempted, ...skipped],
      run.workspaceDir
    );
    if (outcome.accepted.length > 0) {
      outcome.accepted.forEach((url) => {
        receipts[url] = {
          ...receipts[url],
          [deposit.docId]: deposit.fingerprint,
        };
      });
      writeJsonFile(run.publishedPath, receipts);
    }
    outcomes.push(outcome);
    report(progressLine(outcomes.length, pending.length, outcome));
    attempted
      .filter(([, status]) => status.reason === TIMEOUT_REASON)
      .forEach(([url, status]) => {
        report(`${url} timed out, leaving it out for the rest of this run.`);
        health[url] = status;
      });
  }
  return outcomes;
}
/* eslint-enable functional/immutable-data, no-await-in-loop, no-param-reassign */

function summaryLine(outcomes: Outcome[]): string {
  const accepted = outcomes.filter(
    (outcome) => outcome.accepted.length > 0
  ).length;
  const published =
    accepted === outcomes.length
      ? `Published ${accepted} documents.`
      : `Published ${accepted} of ${outcomes.length} documents.`;
  const rejections = outcomes.reduce(
    (count, outcome) => count + outcome.rejected.length,
    0
  );
  return rejections === 0
    ? published
    : `${published} Relay rejections: ${rejections} (retried on the next run).`;
}

export async function runPublishCommand(
  args: string[],
  pool: Pick<SimplePool, "ensureRelay" | "publish" | "close">
): Promise<
  | { help: true; text: string }
  | {
      changed_paths: string[];
      accepted_paths: string[];
      unaccepted_paths: string[];
      rejections: Rejection[];
      warnings: string[];
    }
> {
  const parsed = parseConfigArgs("publish", args);
  if (parsed.help) {
    return { help: true, text: publishHelp() };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const { roomRelays } = profile.workspaceConfig;
  if (!profile.pubkey || !profile.nsecFile || roomRelays.length === 0) {
    throw new Error(
      "Publishing needs a shared workspace: run knowstr init --shared"
    );
  }
  const { pubkey, workspaceDir } = profile;
  const secretKey = await loadWriteSecretKey({
    pubkey,
    nsecFile: profile.nsecFile,
  });

  const saved = await saveEditedWorkspaceDocuments(profile);
  const publishedPath = path.join(
    path.dirname(profile.configPath),
    "published.json"
  );
  const receipts = readReceipts(publishedPath);
  const createdAt = newTimestamp();
  const deposits = saved.documents
    .filter((entry) => entry.warnings.length === 0)
    .map((entry) => depositFor(entry, pubkey, createdAt));
  const pending = deposits.filter(
    (deposit) => pendingRelays(receipts, roomRelays, deposit).length > 0
  );
  report(
    `Saved ${saved.documents.length} documents. Publishing ${
      pending.length
    } to ${roomRelays.length} relays, ${
      deposits.length - pending.length
    } unchanged, ${saved.documents.length - deposits.length} with warnings.`
  );
  const outcomes =
    pending.length === 0
      ? []
      : await publishPending(pending, receipts, {
          relayUrls: roomRelays,
          secretKey,
          pool,
          publishedPath,
          workspaceDir,
        }).finally(() => pool.close(roomRelays));
  report(summaryLine(outcomes));

  const pathOf = (deposit: Deposit): string =>
    path.join(workspaceDir, deposit.relativePath);
  return {
    changed_paths: saved.changed_paths,
    accepted_paths: outcomes
      .filter((outcome) => outcome.accepted.length > 0)
      .map((outcome) => pathOf(outcome.deposit)),
    unaccepted_paths: pending
      .filter(
        (deposit) =>
          pendingRelays(receipts, roomRelays, deposit).length ===
          roomRelays.length
      )
      .map(pathOf),
    rejections: outcomes.flatMap((outcome) => outcome.rejected),
    warnings: saved.warnings,
  };
}
