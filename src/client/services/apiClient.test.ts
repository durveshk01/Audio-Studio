import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "./apiClient";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); ApiClient.setBaseUrl(""); });

it("keeps the health timeout active while the response body is being read", async () => {
  vi.useFakeTimers();
  ApiClient.setBaseUrl("https://backend.example.test");
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })
  })));
  let finished = false;
  const pending = ApiClient.getHealth().then((result) => { finished = true; return result; });
  await vi.advanceTimersByTimeAsync(4001);
  expect(finished).toBe(true);
  expect(await pending).toMatchObject({ ok: false, mode: "local-only" });
});
