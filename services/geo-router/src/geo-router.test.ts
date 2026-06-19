import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAlias, normalizeAdministrative } from "./alias.js";
import { isPoi } from "./classify.js";
import { expand } from "./expand.js";
import type { KodeposEntry } from "./types.js";

const mockData: KodeposEntry[] = [
  { code: 11730, village: "Cengkareng Barat", district: "Cengkareng", regency: "Administrasi Jakarta Barat", province: "DKI Jakarta", latitude: -6.135, longitude: 106.723, elevation: 9, timezone: "WIB" },
  { code: 11740, village: "Rawa Buaya", district: "Cengkareng", regency: "Administrasi Jakarta Barat", province: "DKI Jakarta", latitude: -6.168, longitude: 106.737, elevation: 8, timezone: "WIB" },
  { code: 11220, village: "Tambora", district: "Tambora", regency: "Administrasi Jakarta Barat", province: "DKI Jakarta", latitude: -6.144, longitude: 106.808, elevation: 6, timezone: "WIB" },
  { code: 40184, village: "Andir", district: "Andir", regency: "Bandung", province: "Jawa Barat", latitude: -6.914, longitude: 107.609, elevation: 700, timezone: "WIB" },
  { code: 40115, village: "Sukajadi", district: "Sukajadi", regency: "Bandung", province: "Jawa Barat", latitude: -6.886, longitude: 107.596, elevation: 700, timezone: "WIB" },
];

describe("alias", () => {
  it("maps Jakarta Barat to Administrative name", () => {
    assert.equal(resolveAlias("Jakarta Barat"), "Administrasi Jakarta Barat");
  });
  it("maps jakbar to Administrative name", () => {
    assert.equal(resolveAlias("jakbar"), "Administrasi Jakarta Barat");
  });
  it("maps jaksel", () => {
    assert.equal(resolveAlias("jaksel"), "Administrasi Jakarta Selatan");
  });
  it("passes through unknown names", () => {
    assert.equal(resolveAlias("Bandung"), "Bandung");
  });
  it("normalizes lowercase administrasi", () => {
    assert.equal(normalizeAdministrative("administrasi jakarta barat"), "Administrasi jakarta barat");
  });
});

describe("classify", () => {
  it("detects stasiun as POI", () => {
    assert.equal(isPoi("Stasiun Duri"), true);
  });
  it("detects mall as POI", () => {
    assert.equal(isPoi("mall taman anggrek"), true);
  });
  it("detects universitas as POI", () => {
    assert.equal(isPoi("Universitas Indonesia"), true);
  });
  it("does not detect city name as POI", () => {
    assert.equal(isPoi("Cengkareng"), false);
  });
  it("does not detect Jakarta as POI", () => {
    assert.equal(isPoi("Jakarta Barat"), false);
  });
});

describe("expand", () => {
  it("returns all districts for a regency", () => {
    const result = expand(mockData, "Administrasi Jakarta Barat");
    assert.ok(result);
    assert.equal(result.regency, "Administrasi Jakarta Barat");
    assert.equal(result.province, "DKI Jakarta");
    assert.deepEqual(result.districts, ["Cengkareng", "Tambora"]);
  });
  it("returns districts for Bandung", () => {
    const result = expand(mockData, "Bandung");
    assert.ok(result);
    assert.deepEqual(result.districts, ["Andir", "Sukajadi"]);
  });
  it("returns null for unknown regency", () => {
    const result = expand(mockData, "Tidak Ada");
    assert.equal(result, null);
  });
  it("case insensitive match", () => {
    const result = expand(mockData, "administrasi jakarta barat");
    assert.ok(result);
    assert.equal(result.province, "DKI Jakarta");
  });
});
