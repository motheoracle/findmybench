import { supabase } from './supabase';

export interface ManageSubscriptionOptions {
  returnUrl?: string;
}

export async function openManageSubscription(
  options: ManageSubscriptionOptions = {}
): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('Please sign in to manage your subscription.');
  }

  const returnUrl =
    options.returnUrl ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://findmybench.netlify.app');

  const { data, error } = await supabase.functions.invoke('create-portal-session', {
    body: { returnUrl },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    let serverMessage: string | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const payload = await ctx.json();
        if (payload && typeof payload.error === 'string') {
          serverMessage = payload.error;
        }
      }
    } catch {
      // Ignore JSON parse errors and fall back to default message
    }

    if (serverMessage === 'No Stripe customer found for this account.') {
      throw new Error('No active subscription found for this account yet.');
    }

    throw new Error(serverMessage || error.message || 'Unable to start billing portal session.');
  }

  if (!data?.url || typeof data.url !== 'string') {
    throw new Error('No Stripe billing portal URL was returned.');
  }

  window.location.assign(data.url);
}