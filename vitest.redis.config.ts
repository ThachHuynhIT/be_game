import { defineConfig } from "vitest/config";

// `npm run test:redis`: only the Redis integration tests. They need REDIS_TEST_URL pointing at a disposable,
// local Redis and fail (never skip) when it is missing or unreachable.
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
