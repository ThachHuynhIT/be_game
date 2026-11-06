import { configDefaults, defineConfig } from "vitest/config";

// `npm test`: the unit suite, no external service. Redis integration tests run with `npm run test:redis`
// (vitest.redis.config.ts) against a disposable Redis; CI starts one in the `redis-integration` job.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test/**/*.integration.test.ts"],
    // Seeds Math.random before every test (see the file).
    setupFiles: ["test/setup.ts"],
  },
});
