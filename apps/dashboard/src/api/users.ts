import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

import { api } from "@/api/client";

const userSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  email: z.string(),
  phone: z.string(),
  website: z.string(),
  company: z.object({ name: z.string(), catchPhrase: z.string() }),
  address: z.object({ city: z.string(), street: z.string() }),
});

export type User = z.infer<typeof userSchema>;

// API call 1 — GET /users
export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: async () => {
    const { data } = await api.get("/users");
    return z.array(userSchema).parse(data);
  },
});

// API call 2 — GET /users/:id
export const userQuery = (userId: string) =>
  queryOptions({
    queryKey: ["users", userId],
    queryFn: async () => {
      const { data } = await api.get(`/users/${userId}`);
      return userSchema.parse(data);
    },
  });
