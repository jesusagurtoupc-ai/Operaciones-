import { describe, expect, it } from "vitest";
import { firmaCoincide } from "@/lib/shared/archivos";

const b = (...v: number[]) => new Uint8Array(v);
const t = (s: string) => new TextEncoder().encode(s);

describe("firmaCoincide", () => {
  it("reconoce las firmas de cada formato", () => {
    expect(firmaCoincide("pdf", t("%PDF-1.7\n"))).toBe(true);
    expect(firmaCoincide("jpg", b(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(firmaCoincide("jpeg", b(0xff, 0xd8, 0xff, 0xdb))).toBe(true);
    expect(firmaCoincide("png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(firmaCoincide("gif", t("GIF89a"))).toBe(true);
    expect(firmaCoincide("webp", t("RIFF\0\0\0\0WEBPVP8 "))).toBe(true);
    expect(firmaCoincide("docx", b(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(firmaCoincide("xlsx", b(0x50, 0x4b, 0x03, 0x04))).toBe(true);
  });

  it("acepta un PDF con bytes extra antes de la firma", () => {
    expect(firmaCoincide("pdf", t("\n\n  %PDF-1.4"))).toBe(true);
  });

  it("rechaza contenido que no corresponde a la extensión", () => {
    expect(firmaCoincide("pdf", t("<html>"))).toBe(false);
    expect(firmaCoincide("png", t("MZ\x90\x00"))).toBe(false);
    expect(firmaCoincide("jpg", t("%PDF-1.7"))).toBe(false);
    expect(firmaCoincide("docx", t("<script>"))).toBe(false);
    expect(firmaCoincide("webp", t("RIFF\0\0\0\0WAVE"))).toBe(false);
  });

  it("rechaza archivos vacíos, truncados o de tipo desconocido", () => {
    expect(firmaCoincide("pdf", b())).toBe(false);
    expect(firmaCoincide("png", b(0x89, 0x50))).toBe(false);
    expect(firmaCoincide("exe", t("MZ"))).toBe(false);
  });
});
