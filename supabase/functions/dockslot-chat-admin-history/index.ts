import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized");
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");
    const { data: profile, error: profileError } = await caller.from("profiles").select("role,is_blocked").eq("id", user.id).single();
    if (profileError || profile?.role !== "super_admin" || profile?.is_blocked) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(100, Math.max(1, Number(body.p_limit) || 50));
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc("dockslot_chat_admin_history", { p_before: body.p_before ?? null, p_limit: limit, p_search: body.p_search ?? null, p_before_id: body.p_before_id ?? null });
    if (error) throw error;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    const status = message === "Unauthorized" ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
