import { afterEach, describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../src/server/hub";

describe("isAllowedOrigin", () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGIN;
  });

  it("allows everything when ALLOWED_ORIGIN is unset", () => {
    expect(isAllowedOrigin("https://anything.example", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin(undefined, "x")).toBe(true);
  });

  it("matches exact origins and * wildcards", () => {
    process.env.ALLOWED_ORIGIN = "https://my-site.com, https://*.vercel.app";
    expect(isAllowedOrigin("https://my-site.com", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://portfolio-abc123.vercel.app", "be-game.vercel.app")).toBe(true);
    expect(isAllowedOrigin("https://evil.com", "be-game.vercel.app")).toBe(false);
    expect(isAllowedOrigin("https://my-site.com.evil.com", "be-game.vercel.app")).toBe(false);
  });

  it("always allows same-host pages", () => {
    process.env.ALLOWED_ORIGIN = "https://my-site.com";
    expect(isAllowedOrigin("https://be-game.vercel.app", "be-game.vercel.app")).toBe(true);
  });
});
