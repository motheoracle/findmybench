import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase"; // update this path to your supabase client

const EXPLORER_PAYMENT_LINK =
  "https://buy.stripe.com/cNi5kFgHq11De5N3F51wY00";

export function useExplorerEntitlement() {
  const [isExplorer, setIsExplorer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserId(null);
        setIsExplorer(false);
        return;
      }

      setUserId(user.id);

      const { data, error } = await supabase
        .from("user_entitlements")
        .select("tier, status, expires_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !data) {
        setIsExplorer(false);
        return;
      }

      const notExpired =
        !data.expires_at || new Date(data.expires_at).getTime() > Date.now();

      setIsExplorer(
        data.tier === "explorer" && data.status === "active" && notExpired
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const checkoutUrl = userId
    ? `${EXPLORER_PAYMENT_LINK}?client_reference_id=${encodeURIComponent(userId)}`
    : null;

  return { isExplorer, loading, userId, checkoutUrl, refresh };
}