import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";

const app = express();

// Security headers
app.use(helmet());

// JSON body-size limit (100kb is plenty for this demo)
app.use(express.json({ limit: "100kb" }));

// In-memory user store (demo only - no database)
interface User {
  id: number;
  name: string;
}

const users: User[] = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// List users
app.get("/api/users", (_req: Request, res: Response) => {
  res.json(users);
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Generic error handler - never leak internal details in production
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
