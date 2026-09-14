import { NextResponse } from "next/server";
import { listPersonas, personaSummary } from "@/lib/personas";

export async function GET() {
  const personas = await listPersonas();
  return NextResponse.json({ personas: personas.map(personaSummary) });
}
