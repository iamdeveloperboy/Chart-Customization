import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ConfirmHcaptcha from '@hcaptcha/react-native-hcaptcha';

const ACCENT = '#2563eb';
const SITE_KEY = '00000000-0000-0000-0000-000000000000';
const BASE_URL = 'https://hcaptcha.com';

type CaptchaMessage = {
  success?: boolean;
  nativeEvent: { data: string };
  markUsed?: () => void;
  reset?: () => void;
};

export default function HCaptchaScreen() {
  const captchaRef = useRef<ConfirmHcaptcha>(null);
  const [status, setStatus] = useState('Tap Show Captcha to start');
  const [token, setToken] = useState<string | null>(null);

  const onMessage = useCallback((event: CaptchaMessage) => {
    const data = event?.nativeEvent?.data;
    if (!data) {
      return;
    }

    if (data === 'open') {
      setStatus('Challenge open');
      return;
    }

    if (event.success) {
      setToken(data);
      setStatus('Verified');
      event.markUsed?.();
      captchaRef.current?.hide();
      return;
    }

    if (data === 'challenge-expired') {
      setStatus('Challenge expired — try again');
      event.reset?.();
      return;
    }

    if (data === 'challenge-closed' || data === 'cancel') {
      setStatus('Closed');
      captchaRef.current?.hide();
      return;
    }

    setToken(null);
    setStatus(`Failed: ${data}`);
    captchaRef.current?.hide();
  }, []);

  const showCaptcha = () => {
    setToken(null);
    setStatus('Loading…');
    captchaRef.current?.show();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>hCaptcha</Text>
        <Text style={styles.hint}>
          Opens the official demo challenge. Replace the site key before shipping.
        </Text>

        <Pressable
          onPress={showCaptcha}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
          <Text style={styles.primaryText}>Show Captcha</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{status}</Text>
          {token ? (
            <>
              <Text style={[styles.label, styles.tokenLabel]}>Token</Text>
              <Text style={styles.token} selectable>
                {token}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      <ConfirmHcaptcha
        ref={captchaRef}
        siteKey={SITE_KEY}
        baseUrl={BASE_URL}
        languageCode="en"
        size="invisible"
        showLoading
        onMessage={onMessage}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 24,
    gap: 16,
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 8,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: ACCENT,
  },
  pressed: { opacity: 0.85 },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  label: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  value: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  tokenLabel: { marginTop: 8 },
  token: { fontSize: 11, color: '#475569', lineHeight: 16 },
});
