"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/utils/ids.js
var require_ids = __commonJS({
  "src/utils/ids.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    function newId(prefix) {
      const id = crypto.randomUUID();
      return prefix ? `${prefix}_${id}` : id;
    }
    function nowIso() {
      return (/* @__PURE__ */ new Date()).toISOString();
    }
    module2.exports = { newId, nowIso };
  }
});

// src/middleware/auth.js
var require_auth = __commonJS({
  "src/middleware/auth.js"(exports2, module2) {
    "use strict";
    var jwt = require("jsonwebtoken");
    var JWT_SECRET = process.env.JWT_SECRET || "vela-dev-secret-change-me";
    function signToken(user) {
      return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "2h" });
    }
    function requireAuth(db2) {
      return function(req, res, next) {
        const authHeader = req.header("authorization") || "";
        const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
        if (!match) return res.status(401).json({ error: "UNAUTHORIZED" });
        try {
          const payload = jwt.verify(match[1], JWT_SECRET);
          const user = db2.prepare("SELECT id, email FROM users WHERE id = ?").get(payload.sub);
          if (!user) return res.status(401).json({ error: "SESSION_EXPIRED", message: "Tu sesi\xF3n ya no es v\xE1lida. Inicia sesi\xF3n de nuevo." });
          req.user = { id: user.id, email: user.email };
          next();
        } catch (e) {
          return res.status(401).json({ error: "UNAUTHORIZED" });
        }
      };
    }
    module2.exports = { signToken, requireAuth, JWT_SECRET };
  }
});

// src/modules/auth/auth.routes.js
var require_auth_routes = __commonJS({
  "src/modules/auth/auth.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var bcrypt = require("bcryptjs");
    var { z } = require("zod");
    var { newId, nowIso } = require_ids();
    var { signToken, requireAuth } = require_auth();
    var credentialsSchema = z.object({
      email: z.string().email(),
      password: z.string().min(8, "La contrase\xF1a debe tener al menos 8 caracteres")
    });
    function createAuthRouter(db2) {
      const router = express.Router();
      router.post("/register", (req, res) => {
        const parsed = credentialsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        }
        const { email, password } = parsed.data;
        const existing = db2.prepare("SELECT id FROM users WHERE email = ?").get(email);
        if (existing) return res.status(409).json({ error: "EMAIL_TAKEN" });
        const id = newId("usr");
        const passwordHash = bcrypt.hashSync(password, 10);
        db2.prepare("INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)").run(
          id,
          email,
          passwordHash,
          nowIso(),
          nowIso()
        );
        const user = { id, email };
        res.status(201).json({ user, token: signToken(user) });
      });
      router.post("/login", (req, res) => {
        const parsed = credentialsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        }
        const { email, password } = parsed.data;
        const row = db2.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!row || !bcrypt.compareSync(password, row.password_hash)) {
          return res.status(401).json({ error: "INVALID_CREDENTIALS" });
        }
        const user = { id: row.id, email: row.email };
        res.json({ user, token: signToken(user) });
      });
      router.get("/me", requireAuth(db2), (req, res) => {
        res.json(req.user);
      });
      return router;
    }
    module2.exports = { createAuthRouter };
  }
});

// src/modules/profiles/profiles.routes.js
var require_profiles_routes = __commonJS({
  "src/modules/profiles/profiles.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { z } = require("zod");
    var { newId, nowIso } = require_ids();
    var { requireAuth } = require_auth();
    var createSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
    var patchSchema = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(["active", "inactive"]).optional()
    });
    function dependencyCounts(db2, profileId) {
      const groups = db2.prepare("SELECT COUNT(*) n FROM facebook_groups WHERE profile_id = ? AND deleted_at IS NULL").get(profileId).n;
      const campaigns = db2.prepare("SELECT COUNT(*) n FROM campaigns WHERE profile_id = ? AND deleted_at IS NULL").get(profileId).n;
      const contents = db2.prepare("SELECT COUNT(*) n FROM reusable_contents WHERE profile_id = ? AND deleted_at IS NULL").get(profileId).n;
      const connections = db2.prepare("SELECT COUNT(*) n FROM connector_installations WHERE profile_id = ? AND status != 'revoked'").get(profileId).n;
      return { groups, campaigns, contents, connections };
    }
    function createProfilesRouter(db2) {
      const router = express.Router();
      router.use(requireAuth(db2));
      router.get("/", (req, res) => {
        const rows = db2.prepare("SELECT * FROM connector_profiles WHERE user_id = ? AND status != 'archived' ORDER BY created_at ASC").all(req.user.id);
        res.json(rows.map(toDto));
      });
      router.post("/", (req, res) => {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const id = newId("prof");
        db2.prepare(
          `INSERT INTO connector_profiles (id, user_id, name, description, status, created_at, updated_at)
       VALUES (?,?,?,?, 'active', ?, ?)`
        ).run(id, req.user.id, parsed.data.name, parsed.data.description || null, nowIso(), nowIso());
        res.status(201).json(toDto(db2.prepare("SELECT * FROM connector_profiles WHERE id = ?").get(id)));
      });
      router.patch("/:id", (req, res) => {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const row = db2.prepare("SELECT * FROM connector_profiles WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const next = { ...row, ...parsed.data };
        db2.prepare("UPDATE connector_profiles SET name=?, description=?, status=?, updated_at=? WHERE id=?").run(
          next.name,
          next.description,
          next.status,
          nowIso(),
          row.id
        );
        res.json(toDto(db2.prepare("SELECT * FROM connector_profiles WHERE id = ?").get(row.id)));
      });
      router.delete("/:id", (req, res) => {
        const row = db2.prepare("SELECT * FROM connector_profiles WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const deps = dependencyCounts(db2, row.id);
        const hasDeps = deps.groups > 0 || deps.campaigns > 0 || deps.contents > 0 || deps.connections > 0;
        const confirmed = req.query.confirm === "true";
        if (hasDeps && !confirmed) {
          return res.status(409).json({ error: "HAS_DEPENDENCIES", dependencies: deps });
        }
        db2.prepare("UPDATE connector_profiles SET status='archived', archived_at=?, updated_at=? WHERE id=?").run(
          nowIso(),
          nowIso(),
          row.id
        );
        res.json({ id: row.id, status: "archived" });
      });
      return router;
    }
    function toDto(row) {
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    module2.exports = { createProfilesRouter };
  }
});

// src/modules/groups/groups.routes.js
var require_groups_routes = __commonJS({
  "src/modules/groups/groups.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { z } = require("zod");
    var { newId, nowIso } = require_ids();
    var { requireAuth } = require_auth();
    var patchSchema = z.object({ status: z.enum(["active", "inactive"]).optional() });
    var createSchema = z.object({ name: z.string().min(1), url: z.string().url() });
    function assertOwnedProfile(db2, userId, profileId) {
      return db2.prepare("SELECT id FROM connector_profiles WHERE id = ? AND user_id = ?").get(profileId, userId);
    }
    function createGroupsRouter(db2) {
      const router = express.Router();
      router.get("/profiles/:profileId/groups", requireAuth(db2), (req, res) => {
        if (!assertOwnedProfile(db2, req.user.id, req.params.profileId)) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const { query, status } = req.query;
        let sql = "SELECT * FROM facebook_groups WHERE profile_id = ? AND deleted_at IS NULL";
        const params = [req.params.profileId];
        if (status) {
          sql += " AND status = ?";
          params.push(status);
        }
        if (query) {
          sql += " AND (name LIKE ? OR url LIKE ?)";
          params.push(`%${query}%`, `%${query}%`);
        }
        sql += " ORDER BY created_at DESC";
        res.json(db2.prepare(sql).all(...params).map(toDto));
      });
      router.post("/profiles/:profileId/groups", requireAuth(db2), (req, res) => {
        if (!assertOwnedProfile(db2, req.user.id, req.params.profileId)) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const existing = db2.prepare("SELECT id FROM facebook_groups WHERE profile_id=? AND url=? AND deleted_at IS NULL").get(req.params.profileId, parsed.data.url);
        if (existing) return res.status(409).json({ error: "GROUP_ALREADY_EXISTS" });
        const id = newId("grp");
        db2.prepare(
          `INSERT INTO facebook_groups (id, user_id, profile_id, name, url, status, imported_from, created_at, updated_at)
       VALUES (?,?,?,?,?, 'active', 'manual', ?, ?)`
        ).run(id, req.user.id, req.params.profileId, parsed.data.name, parsed.data.url, nowIso(), nowIso());
        res.status(201).json(toDto(db2.prepare("SELECT * FROM facebook_groups WHERE id=?").get(id)));
      });
      router.patch("/groups/:id", requireAuth(db2), (req, res) => {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR" });
        const row = db2.prepare(
          `SELECT g.* FROM facebook_groups g JOIN connector_profiles p ON p.id = g.profile_id
       WHERE g.id = ? AND p.user_id = ?`
        ).get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: "GROUP_NOT_FOUND" });
        const status = parsed.data.status || row.status;
        db2.prepare("UPDATE facebook_groups SET status=?, updated_at=? WHERE id=?").run(status, nowIso(), row.id);
        res.json(toDto(db2.prepare("SELECT * FROM facebook_groups WHERE id=?").get(row.id)));
      });
      router.delete("/groups/:id", requireAuth(db2), (req, res) => {
        const row = db2.prepare(
          `SELECT g.* FROM facebook_groups g JOIN connector_profiles p ON p.id = g.profile_id
       WHERE g.id = ? AND p.user_id = ?`
        ).get(req.params.id, req.user.id);
        if (!row) return res.status(404).json({ error: "GROUP_NOT_FOUND" });
        db2.prepare("UPDATE facebook_groups SET deleted_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), row.id);
        res.json({ id: row.id, status: "deleted" });
      });
      return router;
    }
    function toDto(row) {
      return {
        id: row.id,
        profileId: row.profile_id,
        name: row.name,
        url: row.url,
        status: row.status,
        importedFrom: row.imported_from,
        lastSeenAt: row.last_seen_at
      };
    }
    module2.exports = { createGroupsRouter };
  }
});
// src/modules/content/content.routes.js
var require_content_routes = __commonJS({
  "src/modules/content/content.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { z } = require("zod");
    var { newId, nowIso } = require_ids();
    var { requireAuth } = require_auth();
    var MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;
    var imageUrlSchema = z.string().max(MAX_IMAGE_DATA_URL_LENGTH, "La imagen es demasiado grande.").refine((value) => {
      if (value.startsWith("data:image/")) return true;
      try {
        new URL(value);
        return true;
      } catch (e) {
        return false;
      }
    }, "imageUrl debe ser una URL v\xE1lida o una imagen (data URL).");
    var createSchema = z.object({
      profileId: z.string().min(1),
      title: z.string().min(1),
      bodyText: z.string().min(1),
      imageUrl: imageUrlSchema.optional()
    });
    var patchSchema = z.object({
      title: z.string().min(1).optional(),
      bodyText: z.string().min(1).optional(),
      imageUrl: imageUrlSchema.optional()
    });
    function ownedContent(db2, userId, id) {
      return db2.prepare("SELECT * FROM reusable_contents WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId);
    }
    function createContentRouter(db2) {
      const router = express.Router();
      router.use(requireAuth(db2));
      router.get("/", (req, res) => {
        let sql = "SELECT * FROM reusable_contents WHERE user_id = ? AND deleted_at IS NULL";
        const params = [req.user.id];
        if (req.query.profileId) {
          sql += " AND profile_id = ?";
          params.push(req.query.profileId);
        }
        sql += " ORDER BY created_at DESC";
        res.json(db2.prepare(sql).all(...params).map(toDto));
      });
      router.post("/", (req, res) => {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const profile = db2.prepare("SELECT id FROM connector_profiles WHERE id = ? AND user_id = ?").get(parsed.data.profileId, req.user.id);
        if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const id = newId("cnt");
        db2.prepare(
          `INSERT INTO reusable_contents (id, user_id, profile_id, title, body_text, image_url, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
        ).run(id, req.user.id, parsed.data.profileId, parsed.data.title, parsed.data.bodyText, parsed.data.imageUrl || null, nowIso(), nowIso());
        res.status(201).json(toDto(db2.prepare("SELECT * FROM reusable_contents WHERE id=?").get(id)));
      });
      router.patch("/:id", (req, res) => {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR" });
        const row = ownedContent(db2, req.user.id, req.params.id);
        if (!row) return res.status(404).json({ error: "CONTENT_NOT_FOUND" });
        const next = { ...row, ...parsed.data };
        db2.prepare("UPDATE reusable_contents SET title=?, body_text=?, image_url=?, updated_at=? WHERE id=?").run(
          next.title,
          next.bodyText ?? next.body_text,
          next.imageUrl ?? next.image_url,
          nowIso(),
          row.id
        );
        res.json(toDto(db2.prepare("SELECT * FROM reusable_contents WHERE id=?").get(row.id)));
      });
      router.post("/:id/duplicate", (req, res) => {
        const row = ownedContent(db2, req.user.id, req.params.id);
        if (!row) return res.status(404).json({ error: "CONTENT_NOT_FOUND" });
        const id = newId("cnt");
        db2.prepare(
          `INSERT INTO reusable_contents (id, user_id, profile_id, title, body_text, image_url, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
        ).run(id, req.user.id, row.profile_id, `${row.title} (copia)`, row.body_text, row.image_url, nowIso(), nowIso());
        res.status(201).json(toDto(db2.prepare("SELECT * FROM reusable_contents WHERE id=?").get(id)));
      });
      router.delete("/:id", (req, res) => {
        const row = ownedContent(db2, req.user.id, req.params.id);
        if (!row) return res.status(404).json({ error: "CONTENT_NOT_FOUND" });
        db2.prepare("UPDATE reusable_contents SET deleted_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), row.id);
        res.json({ id: row.id, status: "deleted" });
      });
      return router;
    }
    function toDto(row) {
      return {
        id: row.id,
        profileId: row.profile_id,
        title: row.title,
        bodyText: row.body_text,
        imageUrl: row.image_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
    module2.exports = { createContentRouter };
  }
});

// src/schemas/connectorResult.schema.js
var require_connectorResult_schema = __commonJS({
  "src/schemas/connectorResult.schema.js"(exports2, module2) {
    "use strict";
    var { z } = require("zod");
    var connectorResultSchema = z.object({
      estado: z.enum(["running", "pending", "published", "error", "paused", "stopped"], {
        errorMap: () => ({ message: "estado debe ser uno de: running, pending, published, error, paused, stopped" })
      }),
      timestamp: z.string().min(1, "timestamp es requerido (ISO-8601)"),
      mensajeError: z.string().min(1, "mensajeError no puede estar vac\xEDo").optional(),
      confirmationUrl: z.string().url("confirmationUrl debe ser una URL v\xE1lida").optional()
    }).strict().superRefine((data, ctx) => {
      if (data.estado === "published" && !data.confirmationUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmationUrl"],
          message: "confirmationUrl es requerido cuando estado=published"
        });
      }
      if (data.estado === "error" && !data.mensajeError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mensajeError"],
          message: "mensajeError es requerido cuando estado=error"
        });
      }
    });
    module2.exports = { connectorResultSchema };
  }
});
// src/modules/queue/queue.service.js
var require_queue_service = __commonJS({
  "src/modules/queue/queue.service.js"(exports2, module2) {
    "use strict";
    var { newId, nowIso } = require_ids();
    var { connectorResultSchema } = require_connectorResult_schema();
    var LOCK_TIMEOUT_MINUTES = 10;
    var TERMINAL_STATES = /* @__PURE__ */ new Set(["published", "error", "awaiting_review"]);
    function minutesAgoIso(minutes) {
      return new Date(Date.now() - minutes * 60 * 1e3).toISOString();
    }
    function localHHMM(date, timeZone) {
      try {
        return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
      } catch (e) {
        return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
      }
    }
    function localDateKey(date, timeZone) {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      } catch (e) {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      }
    }
    function isWithinAllowedWindow(nowHHMM, startHHMM, endHHMM) {
      if (startHHMM <= endHHMM) return nowHHMM >= startHHMM && nowHHMM <= endHHMM;
      return nowHHMM >= startHHMM || nowHHMM <= endHHMM;
    }
    function checkPublishingGate(db2, { profileId, timezone, minIntervalMinutes, maxPerBlock, blockWaitMinutes, dailyLimitPerProfile, allowedStartTime, allowedEndTime }) {
      if (process.env.FACEBOOK_PUBLISHING_AUTHORIZED !== "true") {
        return { allowed: false, reason: "NOT_AUTHORIZED" };
      }
      const tz = timezone || "UTC";
      const now = /* @__PURE__ */ new Date();
      const nowHHMM = localHHMM(now, tz);
      if (!isWithinAllowedWindow(nowHHMM, allowedStartTime, allowedEndTime)) {
        return { allowed: false, reason: "OUTSIDE_ALLOWED_HOURS" };
      }
      const recentDispatches = db2.prepare(
        `SELECT executed_at FROM campaign_history
       WHERE profile_id = ? AND status = 'running'
       ORDER BY executed_at DESC LIMIT 500`
      ).all(profileId);
      if (recentDispatches.length > 0) {
        const lastMs = new Date(recentDispatches[0].executed_at).getTime();
        if (now.getTime() - lastMs < minIntervalMinutes * 60 * 1e3) {
          return { allowed: false, reason: "MIN_INTERVAL" };
        }
      }
      const blockWindowMs = blockWaitMinutes * 60 * 1e3;
      const inBlockWindow = recentDispatches.filter(
        (r) => now.getTime() - new Date(r.executed_at).getTime() < blockWindowMs
      ).length;
      if (inBlockWindow >= maxPerBlock) {
        return { allowed: false, reason: "BLOCK_LIMIT" };
      }
      const todayKey = localDateKey(now, tz);
      const todayCount = recentDispatches.filter((r) => localDateKey(new Date(r.executed_at), tz) === todayKey).length;
      if (todayCount >= dailyLimitPerProfile) {
        return { allowed: false, reason: "DAILY_LIMIT" };
      }
      return { allowed: true };
    }
    function releaseExpiredLocks(db2) {
      const cutoff = minutesAgoIso(LOCK_TIMEOUT_MINUTES);
      db2.prepare(
        `UPDATE campaign_queue
     SET status = 'pending', locked_at = NULL, updated_at = ?
     WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?`
      ).run(nowIso(), cutoff);
    }
    function loadTaskDisplayData(db2, queueId) {
      return db2.prepare(
        `SELECT q.*, c.name AS campaign_name, c.user_id AS campaign_user_id,
              g.name AS group_name, g.url AS group_url,
              ct.id AS content_id, ct.body_text AS content_text, ct.image_url AS content_image_url,
              p.name AS profile_name
       FROM campaign_queue q
       JOIN campaigns c ON c.id = q.campaign_id
       JOIN facebook_groups g ON g.id = q.group_id
       JOIN reusable_contents ct ON ct.id = c.content_id
       JOIN connector_profiles p ON p.id = q.profile_id
       WHERE q.id = ?`
      ).get(queueId);
    }
    function insertHistoryRow(db2, data, status, { errorMessage = null, confirmationUrl = null } = {}) {
      db2.prepare(
        `INSERT INTO campaign_history (
       id, user_id, queue_task_id, profile_id, profile_name_snapshot,
       group_id, group_name_snapshot, group_url_snapshot,
       campaign_id, campaign_name_snapshot, content_id, content_text_snapshot,
       status, error_message, confirmation_url, executed_at, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        newId("hist"),
        data.campaign_user_id,
        data.id,
        data.profile_id,
        data.profile_name,
        data.group_id,
        data.group_name,
        data.group_url,
        data.campaign_id,
        data.campaign_name,
        data.content_id,
        data.content_text,
        status,
        errorMessage,
        confirmationUrl,
        nowIso(),
        nowIso()
      );
    }
    function getNextTask(db2, profileId, timezone) {
      releaseExpiredLocks(db2);
      if (process.env.FACEBOOK_PUBLISHING_AUTHORIZED !== "true") return null;
      const row = db2.prepare(
        `SELECT q.*, c.min_interval_minutes, c.max_per_block, c.block_wait_minutes,
              c.daily_limit_per_profile, c.allowed_start_time, c.allowed_end_time
       FROM campaign_queue q
       JOIN campaigns c ON c.id = q.campaign_id
       WHERE q.profile_id = ? AND q.status = 'pending'
         AND c.status = 'running' AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC, q.execution_order ASC
       LIMIT 1`
      ).get(profileId);
      if (!row) return null;
      const gate = checkPublishingGate(db2, {
        profileId,
        timezone,
        minIntervalMinutes: row.min_interval_minutes,
        maxPerBlock: row.max_per_block,
        blockWaitMinutes: row.block_wait_minutes,
        dailyLimitPerProfile: row.daily_limit_per_profile,
        allowedStartTime: row.allowed_start_time,
        allowedEndTime: row.allowed_end_time
      });
      if (!gate.allowed) return null;
      db2.prepare(
        `UPDATE campaign_queue
     SET status = 'running', locked_at = ?, attempt_count = attempt_count + 1, updated_at = ?
     WHERE id = ?`
      ).run(nowIso(), nowIso(), row.id);
      db2.prepare(`UPDATE connector_installations SET last_task_at = ? WHERE profile_id = ?`).run(nowIso(), profileId);
      const data = loadTaskDisplayData(db2, row.id);
      insertHistoryRow(db2, data, "running");
      return {
        taskId: data.id,
        campaignId: data.campaign_id,
        profileId: data.profile_id,
        groupId: data.group_id,
        groupUrl: data.group_url,
        text: data.content_text,
        imageUrl: data.content_image_url || null,
        executionOrder: data.execution_order
      };
    }
    function submitTaskResult(db2, { taskId, profileId, rawBody }) {
      const parsed = connectorResultSchema.safeParse(rawBody);
      if (!parsed.success) {
        return {
          httpStatus: 400,
          body: {
            error: "VALIDATION_ERROR",
            details: parsed.error.issues.map((i) => i.message)
          }
        };
      }
      const payload = parsed.data;
      const row = db2.prepare("SELECT * FROM campaign_queue WHERE id = ?").get(taskId);
      if (!row) {
        return { httpStatus: 404, body: { error: "TASK_NOT_FOUND" } };
      }
      if (row.profile_id !== profileId) {
        return { httpStatus: 403, body: { error: "PROFILE_MISMATCH" } };
      }
      if (TERMINAL_STATES.has(row.status)) {
        return { httpStatus: 409, body: { error: "TASK_ALREADY_PROCESSED", estadoActual: row.status } };
      }
      const queueStatus = payload.estado === "pending" ? "awaiting_review" : payload.estado;
      const isTerminal = TERMINAL_STATES.has(queueStatus);
      const confirmationUrl = payload.estado === "published" ? payload.confirmationUrl : null;
      const errorMessage = payload.estado === "error" ? payload.mensajeError : null;
      const update = db2.prepare(
        `UPDATE campaign_queue
       SET status = ?, confirmation_url = ?, error_message = ?,
           result_received_at = CASE WHEN ? THEN ? ELSE result_received_at END,
           locked_at = CASE WHEN ? THEN NULL ELSE locked_at END,
           updated_at = ?
       WHERE id = ? AND status NOT IN ('published','error','awaiting_review')`
      ).run(
        queueStatus,
        confirmationUrl,
        errorMessage,
        isTerminal ? 1 : 0,
        nowIso(),
        isTerminal ? 1 : 0,
        nowIso(),
        taskId
      );
      if (update.changes === 0) {
        const current = db2.prepare("SELECT status FROM campaign_queue WHERE id = ?").get(taskId);
        return { httpStatus: 409, body: { error: "TASK_ALREADY_PROCESSED", estadoActual: current.status } };
      }
      const data = loadTaskDisplayData(db2, taskId);
      insertHistoryRow(db2, data, payload.estado, { errorMessage, confirmationUrl });
      if (isTerminal) {
        maybeCompleteCampaign(db2, row.campaign_id);
      }
      return {
        httpStatus: 200,
        body: { taskId, estado: payload.estado, queueAdvanced: isTerminal }
      };
    }
    function maybeCompleteCampaign(db2, campaignId) {
      const remaining = db2.prepare(
        `SELECT COUNT(*) AS n FROM campaign_queue WHERE campaign_id = ? AND status IN ('pending','running')`
      ).get(campaignId);
      if (remaining.n === 0) {
        db2.prepare(
          `UPDATE campaigns SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running'`
        ).run(nowIso(), nowIso(), campaignId);
      }
    }
    function getCampaignProgress(db2, campaignId) {
      const counts = db2.prepare(
        `SELECT
         SUM(CASE WHEN status IN ('published','error','awaiting_review') THEN 1 ELSE 0 END) AS processed,
         SUM(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) AS pending,
         COUNT(*) AS total
       FROM campaign_queue WHERE campaign_id = ?`
      ).get(campaignId);
      return {
        processed: counts.processed || 0,
        pending: counts.pending || 0,
        total: counts.total || 0
      };
    }
    module2.exports = {
      releaseExpiredLocks,
      getNextTask,
      submitTaskResult,
      getCampaignProgress,
      LOCK_TIMEOUT_MINUTES
    };
  }
});
// src/modules/campaigns/campaigns.routes.js
var require_campaigns_routes = __commonJS({
  "src/modules/campaigns/campaigns.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { z } = require("zod");
    var { newId, nowIso } = require_ids();
    var { requireAuth } = require_auth();
    var { getCampaignProgress } = require_queue_service();
    var createSchema = z.object({
      profileId: z.string().min(1),
      contentId: z.string().min(1),
      groupIds: z.array(z.string().min(1)).min(1, "Selecciona al menos un grupo"),
      name: z.string().min(1),
      scheduledAt: z.string().optional()
    });
    function getSettings(db2) {
      return db2.prepare("SELECT * FROM app_settings WHERE id = 1").get();
    }
    function loadCampaign(db2, userId, id) {
      return db2.prepare("SELECT * FROM campaigns WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId);
    }
    function toDto(db2, row) {
      const progress = getCampaignProgress(db2, row.id);
      return {
        id: row.id,
        profileId: row.profile_id,
        contentId: row.content_id,
        name: row.name,
        status: row.status,
        scheduledAt: row.scheduled_at,
        processed: progress.processed,
        pending: progress.pending,
        total: progress.total,
        createdAt: row.created_at,
        minIntervalMinutes: row.min_interval_minutes,
        maxPerBlock: row.max_per_block,
        blockWaitMinutes: row.block_wait_minutes,
        dailyLimitPerProfile: row.daily_limit_per_profile,
        allowedStartTime: row.allowed_start_time,
        allowedEndTime: row.allowed_end_time
      };
    }
    function createCampaignsRouter(db2) {
      const router = express.Router();
      router.use(requireAuth(db2));
      router.get("/", (req, res) => {
        let sql = "SELECT * FROM campaigns WHERE user_id = ? AND deleted_at IS NULL";
        const params = [req.user.id];
        if (req.query.profileId) {
          sql += " AND profile_id = ?";
          params.push(req.query.profileId);
        }
        sql += " ORDER BY created_at DESC";
        res.json(db2.prepare(sql).all(...params).map((r) => toDto(db2, r)));
      });
      router.post("/", (req, res) => {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const { profileId, contentId, groupIds, name, scheduledAt } = parsed.data;
        const profile = db2.prepare("SELECT id FROM connector_profiles WHERE id=? AND user_id=?").get(profileId, req.user.id);
        if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const content = db2.prepare("SELECT id FROM reusable_contents WHERE id=? AND user_id=? AND profile_id=?").get(contentId, req.user.id, profileId);
        if (!content) return res.status(404).json({ error: "CONTENT_NOT_FOUND" });
        const settings = getSettings(db2);
        const id = newId("cmp");
        db2.prepare(
          `INSERT INTO campaigns (
         id, user_id, profile_id, content_id, name, scheduled_at, status,
         min_interval_minutes, max_per_block, block_wait_minutes, daily_limit_per_profile,
         allowed_start_time, allowed_end_time, created_at, updated_at
       ) VALUES (?,?,?,?,?,?, ?, ?,?,?,?, ?,?, ?,?)`
        ).run(
          id,
          req.user.id,
          profileId,
          contentId,
          name,
          scheduledAt || null,
          scheduledAt ? "scheduled" : "draft",
          settings.min_interval_minutes,
          settings.max_per_block,
          settings.block_wait_minutes,
          settings.daily_limit_per_profile,
          settings.allowed_start_time,
          settings.allowed_end_time,
          nowIso(),
          nowIso()
        );
        groupIds.forEach((groupId, index) => {
          const group = db2.prepare("SELECT id FROM facebook_groups WHERE id=? AND profile_id=?").get(groupId, profileId);
          if (!group) return;
          db2.prepare("INSERT INTO campaign_groups (id, campaign_id, group_id) VALUES (?,?,?)").run(newId("cg"), id, groupId);
          db2.prepare(
            `INSERT INTO campaign_queue (id, campaign_id, profile_id, group_id, execution_order, status, created_at, updated_at)
         VALUES (?,?,?,?,?, 'pending', ?, ?)`
          ).run(newId("task"), id, profileId, groupId, index + 1, nowIso(), nowIso());
        });
        res.status(201).json(toDto(db2, db2.prepare("SELECT * FROM campaigns WHERE id=?").get(id)));
      });
      router.get("/:id", (req, res) => {
        const row = loadCampaign(db2, req.user.id, req.params.id);
        if (!row) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
        res.json(toDto(db2, row));
      });
      function transition(status, allowedFrom, timestampColumn) {
        return (req, res) => {
          const row = loadCampaign(db2, req.user.id, req.params.id);
          if (!row) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
          if (!allowedFrom.includes(row.status)) {
            return res.status(409).json({ error: "INVALID_TRANSITION", from: row.status, to: status });
          }
          const cols = timestampColumn ? `, ${timestampColumn} = ?` : "";
          const params = timestampColumn ? [status, nowIso(), nowIso(), row.id] : [status, nowIso(), row.id];
          db2.prepare(`UPDATE campaigns SET status = ?, updated_at = ?${cols} WHERE id = ?`).run(...params);
          if (status === "stopped") {
            db2.prepare(`UPDATE campaign_queue SET status='stopped', updated_at=? WHERE campaign_id=? AND status='pending'`).run(nowIso(), row.id);
          }
          if (status === "paused") {
            db2.prepare(`UPDATE campaign_queue SET status='paused', updated_at=? WHERE campaign_id=? AND status='pending'`).run(nowIso(), row.id);
          }
          if (status === "running" && row.status === "paused") {
            db2.prepare(`UPDATE campaign_queue SET status='pending', updated_at=? WHERE campaign_id=? AND status='paused'`).run(nowIso(), row.id);
          }
          res.json(toDto(db2, db2.prepare("SELECT * FROM campaigns WHERE id=?").get(row.id)));
        };
      }
      router.post("/:id/start", transition("running", ["draft", "scheduled"], "started_at"));
      router.post("/:id/pause", transition("paused", ["running"], "paused_at"));
      router.post("/:id/resume", transition("running", ["paused"], null));
      router.post("/:id/stop", transition("stopped", ["draft", "scheduled", "running", "paused"], "stopped_at"));
      router.delete("/:id", (req, res) => {
        const row = loadCampaign(db2, req.user.id, req.params.id);
        if (!row) return res.status(404).json({ error: "CAMPAIGN_NOT_FOUND" });
        const historyCount = db2.prepare("SELECT COUNT(*) n FROM campaign_history WHERE campaign_id = ?").get(row.id).n;
        if (historyCount > 0 && req.query.confirm !== "true") {
          return res.status(409).json({ error: "HAS_HISTORY", historyCount });
        }
        db2.prepare("UPDATE campaigns SET deleted_at=?, updated_at=? WHERE id=?").run(nowIso(), nowIso(), row.id);
        res.json({ id: row.id, status: "deleted" });
      });
      return router;
    }
    module2.exports = { createCampaignsRouter };
  }
});

// src/modules/history/history.routes.js
var require_history_routes = __commonJS({
  "src/modules/history/history.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { requireAuth } = require_auth();
    function createHistoryRouter(db2) {
      const router = express.Router();
      router.use(requireAuth(db2));
      router.get("/", (req, res) => {
        let sql = "SELECT * FROM campaign_history WHERE user_id = ?";
        const params = [req.user.id];
        const { profileId, campaignId, groupId, status, from, to } = req.query;
        if (profileId) {
          sql += " AND profile_id = ?";
          params.push(profileId);
        }
        if (campaignId) {
          sql += " AND campaign_id = ?";
          params.push(campaignId);
        }
        if (groupId) {
          sql += " AND group_id = ?";
          params.push(groupId);
        }
        if (status) {
          sql += " AND status = ?";
          params.push(status);
        }
        if (from) {
          sql += " AND executed_at >= ?";
          params.push(from);
        }
        if (to) {
          sql += " AND executed_at <= ?";
          params.push(to);
        }
        sql += " ORDER BY executed_at DESC LIMIT 500";
        res.json(db2.prepare(sql).all(...params).map(toDto));
      });
      return router;
    }
    function toDto(row) {
      return {
        id: row.id,
        executedAt: row.executed_at,
        profile: row.profile_name_snapshot,
        group: row.group_name_snapshot,
        campaign: row.campaign_name_snapshot,
        content: row.content_text_snapshot,
        status: row.status,
        errorMessage: row.error_message,
        confirmationUrl: row.confirmation_url
      };
    }
    module2.exports = { createHistoryRouter };
  }
});

// src/modules/settings/settings.routes.js
var require_settings_routes = __commonJS({
  "src/modules/settings/settings.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { z } = require("zod");
    var { nowIso } = require_ids();
    var { requireAuth } = require_auth();
    var patchSchema = z.object({
      minIntervalMinutes: z.number().int().positive().optional(),
      maxPerBlock: z.number().int().positive().optional(),
      blockWaitMinutes: z.number().int().positive().optional(),
      dailyLimitPerProfile: z.number().int().positive().optional(),
      allowedStartTime: z.string().optional(),
      allowedEndTime: z.string().optional()
    });
    function toDto(row) {
      return {
        minIntervalMinutes: row.min_interval_minutes,
        maxPerBlock: row.max_per_block,
        blockWaitMinutes: row.block_wait_minutes,
        dailyLimitPerProfile: row.daily_limit_per_profile,
        allowedStartTime: row.allowed_start_time,
        allowedEndTime: row.allowed_end_time,
        facebookPublishingAuthorized: Boolean(row.facebook_publishing_authorized),
        updatedAt: row.updated_at
      };
    }
    function createSettingsRouter(db2) {
      const router = express.Router();
      router.use(requireAuth(db2));
      router.get("/", (req, res) => {
        res.json(toDto(db2.prepare("SELECT * FROM app_settings WHERE id = 1").get()));
      });
      router.patch("/", (req, res) => {
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues.map((i) => i.message) });
        const current = db2.prepare("SELECT * FROM app_settings WHERE id = 1").get();
        const next = {
          min_interval_minutes: parsed.data.minIntervalMinutes ?? current.min_interval_minutes,
          max_per_block: parsed.data.maxPerBlock ?? current.max_per_block,
          block_wait_minutes: parsed.data.blockWaitMinutes ?? current.block_wait_minutes,
          daily_limit_per_profile: parsed.data.dailyLimitPerProfile ?? current.daily_limit_per_profile,
          allowed_start_time: parsed.data.allowedStartTime ?? current.allowed_start_time,
          allowed_end_time: parsed.data.allowedEndTime ?? current.allowed_end_time
        };
        db2.prepare(
          `UPDATE app_settings SET min_interval_minutes=?, max_per_block=?, block_wait_minutes=?,
       daily_limit_per_profile=?, allowed_start_time=?, allowed_end_time=?, updated_at=? WHERE id=1`
        ).run(
          next.min_interval_minutes,
          next.max_per_block,
          next.block_wait_minutes,
          next.daily_limit_per_profile,
          next.allowed_start_time,
          next.allowed_end_time,
          nowIso()
        );
        res.json(toDto(db2.prepare("SELECT * FROM app_settings WHERE id = 1").get()));
      });
      return router;
    }
    module2.exports = { createSettingsRouter };
  }
});

// src/utils/crypto.js
var require_crypto = __commonJS({
  "src/utils/crypto.js"(exports2, module2) {
    "use strict";
    var crypto = require("crypto");
    function generateConnectorKey() {
      return crypto.randomBytes(32).toString("hex");
    }
    function hashConnectorKey(key) {
      return crypto.createHash("sha256").update(key, "utf8").digest("hex");
    }
    module2.exports = { generateConnectorKey, hashConnectorKey };
  }
});

// src/middleware/connectorAuth.js
var require_connectorAuth = __commonJS({
  "src/middleware/connectorAuth.js"(exports2, module2) {
    "use strict";
    var { hashConnectorKey } = require_crypto();
    var { nowIso } = require_ids();
    function createConnectorAuthMiddleware(db2) {
      return function connectorAuth(req, res, next) {
        const authHeader = req.header("authorization") || "";
        const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
        if (!match) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Falta el encabezado Authorization: Bearer <connectorKey>." });
        }
        const rawKey = match[1].trim();
        const installationId = req.header("x-vela-installation");
        if (!installationId) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Falta el encabezado X-Vela-Installation." });
        }
        const row = db2.prepare("SELECT * FROM connector_installations WHERE installation_id = ?").get(installationId);
        if (!row) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Instalaci\xF3n desconocida." });
        }
        if (row.status === "revoked") {
          return res.status(401).json({ error: "TOKEN_REVOKED", message: "La clave de conexi\xF3n fue revocada." });
        }
        const keyHash = hashConnectorKey(rawKey);
        if (keyHash !== row.connector_key_hash) {
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Clave de conexi\xF3n inv\xE1lida." });
        }
        const timezone = req.header("x-vela-timezone") || row.timezone || "UTC";
        const extensionVersion = req.header("x-vela-extension-version") || row.extension_version || null;
        db2.prepare(
          `UPDATE connector_installations
       SET last_seen_at = ?, timezone = ?, extension_version = ?, status = 'connected', updated_at = ?
       WHERE id = ?`
        ).run(nowIso(), timezone, extensionVersion, nowIso(), row.id);
        req.connector = {
          installationRowId: row.id,
          installationId: row.installation_id,
          profileId: row.profile_id,
          userId: row.user_id,
          timezone,
          extensionVersion
        };
        next();
      };
    }
    module2.exports = { createConnectorAuthMiddleware };
  }
});

// src/modules/connector/connector.service.js
var require_connector_service = __commonJS({
  "src/modules/connector/connector.service.js"(exports2, module2) {
    "use strict";
    var { newId, nowIso } = require_ids();
    function getStatus(db2, connector) {
      const profile = db2.prepare("SELECT id, name, status FROM connector_profiles WHERE id = ?").get(connector.profileId);
      return {
        connected: true,
        installationId: connector.installationId,
        profileId: connector.profileId,
        profileName: profile ? profile.name : null,
        // Interruptor maestro real: la variable de entorno FACEBOOK_PUBLISHING_AUTHORIZED
        // del servidor. Se activa \xFAnicamente cuando la persona autoriz\xF3 la fase de
        // Facebook, y se puede apagar al instante quitando esa variable en Render.
        facebookPublishingEnabled: process.env.FACEBOOK_PUBLISHING_AUTHORIZED === "true",
        serverTime: nowIso()
      };
    }
    var NOTABLE_EVENTS = /* @__PURE__ */ new Set(["checkpoint_detected", "captcha_detected", "disconnected"]);
    function recordControlEvent(db2, connector, { event, message }) {
      if (NOTABLE_EVENTS.has(event)) {
        db2.prepare(
          `UPDATE connector_installations SET last_error_message = ?, updated_at = ? WHERE id = ?`
        ).run(message || event, nowIso(), connector.installationRowId);
      }
      return { acknowledged: true };
    }
    function importGroups(db2, connector, groups) {
      let imported = 0;
      let skipped = 0;
      const result = [];
      for (const g of groups) {
        const existing = db2.prepare("SELECT id FROM facebook_groups WHERE profile_id = ? AND url = ?").get(connector.profileId, g.url);
        if (existing) {
          db2.prepare(
            `UPDATE facebook_groups SET name = ?, external_group_id = ?, last_seen_at = ?, updated_at = ?
         WHERE id = ?`
          ).run(g.name, g.externalGroupId || null, nowIso(), nowIso(), existing.id);
          skipped++;
          result.push({ id: existing.id, name: g.name, url: g.url, status: "active" });
        } else {
          const id = newId("grp");
          db2.prepare(
            `INSERT INTO facebook_groups (id, user_id, profile_id, name, url, external_group_id, status, imported_from, last_seen_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'active', 'connector', ?, ?, ?)`
          ).run(id, connector.userId, connector.profileId, g.name, g.url, g.externalGroupId || null, nowIso(), nowIso(), nowIso());
          imported++;
          result.push({ id, name: g.name, url: g.url, status: "active" });
        }
      }
      return { imported, skipped, groups: result };
    }
    module2.exports = { getStatus, recordControlEvent, importGroups };
  }
});

// src/modules/connector/connector.routes.js
var require_connector_routes = __commonJS({
  "src/modules/connector/connector.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { createConnectorAuthMiddleware } = require_connectorAuth();
    var connectorService = require_connector_service();
    var queueService = require_queue_service();
    function createConnectorRouter(db2) {
      const router = express.Router();
      const connectorAuth = createConnectorAuthMiddleware(db2);
      router.use(connectorAuth);
      router.get("/status", (req, res) => {
        res.json(connectorService.getStatus(db2, req.connector));
      });
      router.get("/tasks/next", (req, res) => {
        const task = queueService.getNextTask(db2, req.connector.profileId, req.connector.timezone);
        res.json({ task });
      });
      router.post("/tasks/:taskId/result", (req, res) => {
        const outcome = queueService.submitTaskResult(db2, {
          taskId: req.params.taskId,
          profileId: req.connector.profileId,
          rawBody: req.body
        });
        res.status(outcome.httpStatus).json(outcome.body);
      });
      router.post("/control", (req, res) => {
        const { event, message } = req.body || {};
        if (!event || typeof event !== "string") {
          return res.status(400).json({ error: "VALIDATION_ERROR", details: ["event es requerido"] });
        }
        res.json(connectorService.recordControlEvent(db2, req.connector, { event, message }));
      });
      router.post("/groups/import", (req, res) => {
        const groups = Array.isArray(req.body && req.body.groups) ? req.body.groups : null;
        if (!groups) {
          return res.status(400).json({ error: "VALIDATION_ERROR", details: ["groups debe ser un arreglo"] });
        }
        for (const g of groups) {
          if (!g || typeof g.name !== "string" || typeof g.url !== "string") {
            return res.status(400).json({ error: "VALIDATION_ERROR", details: ["cada grupo requiere name y url"] });
          }
        }
        res.json(connectorService.importGroups(db2, req.connector, groups));
      });
      return router;
    }
    module2.exports = { createConnectorRouter };
  }
});

// src/modules/connector/installations.routes.js
var require_installations_routes = __commonJS({
  "src/modules/connector/installations.routes.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var { newId, nowIso } = require_ids();
    var { generateConnectorKey, hashConnectorKey } = require_crypto();
    var { requireAuth } = require_auth();
    function toDto(row) {
      if (!row) return null;
      return {
        installationId: row.installation_id,
        profileId: row.profile_id,
        status: row.status,
        extensionVersion: row.extension_version,
        lastSeenAt: row.last_seen_at,
        lastTaskAt: row.last_task_at,
        lastErrorMessage: row.last_error_message
      };
    }
    function createInstallationsRouter(db2) {
      const router = express.Router();
      router.get("/profiles/:profileId/connector", requireAuth(db2), (req, res) => {
        const profile = db2.prepare("SELECT id FROM connector_profiles WHERE id=? AND user_id=?").get(req.params.profileId, req.user.id);
        if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        const row = db2.prepare("SELECT * FROM connector_installations WHERE profile_id = ? AND status != 'revoked' ORDER BY created_at DESC LIMIT 1").get(req.params.profileId);
        res.json(toDto(row));
      });
      router.post("/profiles/:profileId/connector", requireAuth(db2), (req, res) => {
        const profile = db2.prepare("SELECT id FROM connector_profiles WHERE id=? AND user_id=?").get(req.params.profileId, req.user.id);
        if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        db2.prepare("UPDATE connector_installations SET status='revoked', revoked_at=? WHERE profile_id=? AND status!='revoked'").run(
          nowIso(),
          req.params.profileId
        );
        const installationId = newId("inst");
        const connectorKey = generateConnectorKey();
        const id = newId("conn");
        db2.prepare(
          `INSERT INTO connector_installations (id, user_id, profile_id, installation_id, connector_key_hash, status, created_at, updated_at)
       VALUES (?,?,?,?,?, 'connected', ?, ?)`
        ).run(id, req.user.id, req.params.profileId, installationId, hashConnectorKey(connectorKey), nowIso(), nowIso());
        res.status(201).json({ installationId, connectorKey });
      });
      router.post("/profiles/:profileId/connector/revoke", requireAuth(db2), (req, res) => {
        const profile = db2.prepare("SELECT id FROM connector_profiles WHERE id=? AND user_id=?").get(req.params.profileId, req.user.id);
        if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
        db2.prepare("UPDATE connector_installations SET status='revoked', revoked_at=? WHERE profile_id=? AND status!='revoked'").run(
          nowIso(),
          req.params.profileId
        );
        res.json({ status: "revoked" });
      });
      return router;
    }
    module2.exports = { createInstallationsRouter };
  }
});

// src/middleware/errorHandler.js
var require_errorHandler = __commonJS({
  "src/middleware/errorHandler.js"(exports2, module2) {
    "use strict";
    function errorHandler(err, req, res, next) {
      console.error(err);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Ocurri\xF3 un error inesperado." });
    }
    module2.exports = { errorHandler };
  }
});

// src/app.js
var require_app = __commonJS({
  "src/app.js"(exports2, module2) {
    "use strict";
    var express = require("express");
    var cors = require("cors");
    var { createAuthRouter } = require_auth_routes();
    var { createProfilesRouter } = require_profiles_routes();
    var { createGroupsRouter } = require_groups_routes();
    var { createContentRouter } = require_content_routes();
    var { createCampaignsRouter } = require_campaigns_routes();
    var { createHistoryRouter } = require_history_routes();
    var { createSettingsRouter } = require_settings_routes();
    var { createConnectorRouter } = require_connector_routes();
    var { createInstallationsRouter } = require_installations_routes();
    var { errorHandler } = require_errorHandler();
    function createApp2(db2) {
      const app2 = express();
      app2.use(cors());
      app2.use(express.json({ limit: "10mb" }));
      app2.get("/api/health", (req, res) => res.json({ ok: true, service: "vela-backend" }));
      app2.use("/api/auth", createAuthRouter(db2));
      app2.use("/api/profiles", createProfilesRouter(db2));
      app2.use("/api", createGroupsRouter(db2));
      app2.use("/api/contents", createContentRouter(db2));
      app2.use("/api/campaigns", createCampaignsRouter(db2));
      app2.use("/api/history", createHistoryRouter(db2));
      app2.use("/api/settings", createSettingsRouter(db2));
      app2.use("/api", createInstallationsRouter(db2));
      app2.use("/api/connector", createConnectorRouter(db2));
      app2.use((req, res) => res.status(404).json({ error: "NOT_FOUND" }));
      app2.use(errorHandler);
      return app2;
    }
    module2.exports = { createApp: createApp2 };
  }
});

// src/db/index.js
var require_db = __commonJS({
  "src/db/index.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var { DatabaseSync } = require("node:sqlite");
    var SCHEMA_PATH = path.join(__dirname, "schema.sql");
    function createDb2(filePath) {
      const db2 = new DatabaseSync(filePath);
      db2.exec("PRAGMA foreign_keys = ON;");
      const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
      db2.exec(schema);
      return db2;
    }
    function defaultDbPath2() {
      const dataDir = path.join(__dirname, "..", "..", "data");
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      return path.join(dataDir, "vela.db");
    }
    module2.exports = { createDb: createDb2, defaultDbPath: defaultDbPath2 };
  }
});

// src/server.js
require("dotenv").config();
var { createApp } = require_app();
var { createDb, defaultDbPath } = require_db();
var PORT = process.env.PORT || 4e3;
var dbPath = process.env.VELA_DB_PATH || defaultDbPath();
var db = createDb(dbPath);
var app = createApp(db);
app.listen(PORT, () => {
  console.log(`VELA backend escuchando en http://localhost:${PORT} (base de datos: ${dbPath})`);
});
