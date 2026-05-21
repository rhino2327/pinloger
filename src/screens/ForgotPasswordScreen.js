import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  sendPasswordResetEmail,
  signInWithPhoneNumber,
  updatePassword,
} from 'firebase/auth';
import { auth } from '../config/firebase';

// 웹에서만 RecaptchaVerifier 사용
let RecaptchaVerifier;
if (Platform.OS === 'web') {
  RecaptchaVerifier = require('firebase/auth').RecaptchaVerifier;
}

const STEP = {
  INPUT: 'input',
  CODE: 'code',
  NEW_PW: 'new_pw',
  DONE: 'done',
};

export default function ForgotPasswordScreen({ navigation }) {
  const [tab, setTab] = useState('email');
  const [step, setStep] = useState(STEP.INPUT);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmResult, setConfirmResult] = useState(null);
  const [phoneUser, setPhoneUser] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const clearState = () => { setError(''); setSuccessMsg(''); };

  // ── 이메일 재설정 ─────────────────────────────────────────
  const sendEmailReset = async () => {
    clearState();
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('올바른 이메일 형식이 아닙니다.'); return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setStep(STEP.DONE);
      setSuccessMsg(`${email.trim()} 으로\n비밀번호 재설정 링크를 보냈어요.\n메일함을 확인해주세요.`);
    } catch (e) {
      const msgs = {
        'auth/user-not-found': '등록되지 않은 이메일입니다.',
        'auth/invalid-email': '올바른 이메일 형식이 아닙니다.',
        'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      };
      setError(msgs[e.code] || '오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  // ── 전화 인증: 코드 발송 (웹 전용) ──────────────────────────
  const sendPhoneCode = async () => {
    clearState();

    // 네이티브(Expo Go)에서는 안내 메시지 표시
    if (Platform.OS !== 'web') {
      setError('전화번호 인증은 현재 앱 빌드(iOS/Android) 환경에서만 지원됩니다.\n이메일로 비밀번호를 재설정해주세요.');
      return;
    }

    const cleaned = phone.trim().replace(/[\s\-]/g, '');
    if (!cleaned) { setError('전화번호를 입력해주세요.'); return; }

    let formatted = cleaned;
    if (formatted.startsWith('0')) {
      formatted = '+82' + formatted.slice(1);
    } else if (!formatted.startsWith('+')) {
      formatted = '+82' + formatted;
    }

    setLoading(true);
    try {
      if (!window._recaptchaVerifier) {
        window._recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible',
          callback: () => {},
        });
      }
      const result = await signInWithPhoneNumber(auth, formatted, window._recaptchaVerifier);
      setConfirmResult(result);
      setStep(STEP.CODE);
    } catch (e) {
      const msgs = {
        'auth/invalid-phone-number': '올바른 전화번호 형식이 아닙니다. (예: 010-1234-5678)',
        'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
        'auth/quota-exceeded': 'SMS 발송 한도를 초과했습니다.',
      };
      setError(msgs[e.code] || `전화 인증 오류: ${e.message}`);
      if (window._recaptchaVerifier) {
        window._recaptchaVerifier.clear();
        window._recaptchaVerifier = null;
      }
    } finally {
      setLoading(false);
    }
  };

  // ── OTP 확인 ─────────────────────────────────────────────
  const verifyOtp = async () => {
    clearState();
    if (!otp.trim() || otp.trim().length < 6) {
      setError('6자리 인증 코드를 입력해주세요.'); return;
    }
    setLoading(true);
    try {
      const result = await confirmResult.confirm(otp.trim());
      setPhoneUser(result.user);
      setStep(STEP.NEW_PW);
    } catch (e) {
      const msgs = {
        'auth/invalid-verification-code': '인증 코드가 올바르지 않습니다.',
        'auth/code-expired': '인증 코드가 만료됐습니다. 다시 요청해주세요.',
      };
      setError(msgs[e.code] || '인증 코드 확인 중 오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  };

  // ── 새 비밀번호 저장 ──────────────────────────────────────
  const saveNewPassword = async () => {
    clearState();
    if (!newPassword) { setError('새 비밀번호를 입력해주세요.'); return; }
    if (newPassword.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (newPassword !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    try {
      await updatePassword(phoneUser, newPassword);
      setStep(STEP.DONE);
      setSuccessMsg('비밀번호가 성공적으로 변경됐어요!\n새 비밀번호로 로그인해주세요.');
    } catch (e) {
      setError('비밀번호 변경 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setStep(STEP.INPUT);
    setEmail(''); setPhone(''); setOtp('');
    setNewPassword(''); setConfirmPassword('');
    setError(''); setSuccessMsg('');
    setConfirmResult(null); setPhoneUser(null);
  };

  const switchTab = (t) => { setTab(t); resetAll(); };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      {/* 웹용 invisible reCAPTCHA */}
      {Platform.OS === 'web' && <View nativeID="recaptcha-container" />}

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← 로그인으로 돌아가기</Text>
        </TouchableOpacity>

        <Text style={styles.title}>비밀번호 찾기</Text>
        <Text style={styles.subtitle}>
          가입 시 사용한 이메일 또는 전화번호로{'\n'}인증 후 비밀번호를 재설정할 수 있어요.
        </Text>

        {/* 탭 */}
        {step === STEP.INPUT && (
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, tab === 'email' && styles.tabActive]}
              onPress={() => switchTab('email')}
            >
              <Text style={[styles.tabText, tab === 'email' && styles.tabTextActive]}>📧 이메일</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'phone' && styles.tabActive]}
              onPress={() => switchTab('phone')}
            >
              <Text style={[styles.tabText, tab === 'phone' && styles.tabTextActive]}>📱 전화번호</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 완료 화면 ── */}
        {step === STEP.DONE && (
          <View style={styles.doneBox}>
            <Text style={styles.doneIcon}>✅</Text>
            <Text style={styles.doneTitle}>
              {tab === 'email' ? '메일을 보냈어요!' : '비밀번호 변경 완료!'}
            </Text>
            <Text style={styles.doneMsg}>{successMsg}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.primaryBtnText}>로그인 화면으로</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 이메일 탭 ── */}
        {tab === 'email' && step === STEP.INPUT && (
          <View>
            <Text style={styles.label}>가입한 이메일 주소</Text>
            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              placeholder="example@email.com"
              placeholderTextColor="#666"
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            {error ? <Text style={styles.errorText}>⚠ {error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={sendEmailReset}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>재설정 메일 보내기</Text>
              }
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                📌 입력한 이메일로 비밀번호 재설정 링크가 발송됩니다.{'\n'}
                스팸 메일함도 확인해보세요.
              </Text>
            </View>
          </View>
        )}

        {/* ── 전화번호 탭 - STEP 1 ── */}
        {tab === 'phone' && step === STEP.INPUT && (
          <View>
            {Platform.OS !== 'web' && (
              <View style={styles.nativeNoticeBox}>
                <Text style={styles.nativeNoticeTitle}>📱 전화번호 인증 안내</Text>
                <Text style={styles.nativeNoticeText}>
                  전화번호 SMS 인증은 현재 Expo Go 환경에서 지원되지 않아요.{'\n\n'}
                  아래 방법을 이용해 주세요:{'\n'}
                  • <Text style={{ color: '#fff', fontWeight: 'bold' }}>이메일 탭</Text>에서 비밀번호 재설정 메일을 받거나{'\n'}
                  • 앱을 정식 빌드(EAS Build) 후 사용하시면 전화번호 인증이 활성화됩니다.
                </Text>
                <TouchableOpacity
                  style={styles.switchEmailBtn}
                  onPress={() => switchTab('email')}
                >
                  <Text style={styles.switchEmailBtnText}>📧 이메일로 재설정하기</Text>
                </TouchableOpacity>
              </View>
            )}

            {Platform.OS === 'web' && (
              <>
                <Text style={styles.label}>전화번호</Text>
                <View style={styles.phoneRow}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>🇰🇷 +82</Text>
                  </View>
                  <TextInput
                    style={[styles.phoneInput, error ? styles.inputError : null]}
                    placeholder="010-1234-5678"
                    placeholderTextColor="#666"
                    value={phone}
                    onChangeText={t => { setPhone(t); setError(''); }}
                    keyboardType="phone-pad"
                  />
                </View>
                {error ? <Text style={styles.errorText}>⚠ {error}</Text> : null}

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && styles.btnDisabled]}
                  onPress={sendPhoneCode}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.primaryBtnText}>인증 코드 받기</Text>
                  }
                </TouchableOpacity>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    📌 가입 시 등록한 전화번호로 6자리 인증 코드가 발송됩니다.
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* ── 전화번호 탭 - STEP 2: OTP ── */}
        {tab === 'phone' && step === STEP.CODE && (
          <View>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.stepDotDone]} />
              <View style={styles.stepLine} />
              <View style={[styles.stepDot, styles.stepDotActive]} />
              <View style={styles.stepLine} />
              <View style={styles.stepDot} />
            </View>
            <Text style={styles.stepLabel}>STEP 2 · 인증 코드 확인</Text>

            <Text style={styles.sentMsg}>
              📱 {phone} 으로{'\n'}6자리 인증 코드를 발송했어요.
            </Text>

            <Text style={styles.label}>인증 코드 6자리</Text>
            <TextInput
              style={[styles.input, styles.otpInput, error ? styles.inputError : null]}
              placeholder="000000"
              placeholderTextColor="#666"
              value={otp}
              onChangeText={t => { setOtp(t.replace(/[^0-9]/g, '').slice(0, 6)); setError(''); }}
              keyboardType="number-pad"
              maxLength={6}
            />
            {error ? <Text style={styles.errorText}>⚠ {error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={verifyOtp}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>코드 확인</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendBtn} onPress={resetAll}>
              <Text style={styles.resendText}>코드를 받지 못했나요? 다시 요청</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 전화번호 탭 - STEP 3: 새 비밀번호 ── */}
        {tab === 'phone' && step === STEP.NEW_PW && (
          <View>
            <View style={styles.stepIndicator}>
              <View style={[styles.stepDot, styles.stepDotDone]} />
              <View style={[styles.stepLine, styles.stepLineDone]} />
              <View style={[styles.stepDot, styles.stepDotDone]} />
              <View style={styles.stepLine} />
              <View style={[styles.stepDot, styles.stepDotActive]} />
            </View>
            <Text style={styles.stepLabel}>STEP 3 · 새 비밀번호 설정</Text>

            <Text style={styles.label}>새 비밀번호</Text>
            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              placeholder="6자 이상 입력해주세요"
              placeholderTextColor="#666"
              value={newPassword}
              onChangeText={t => { setNewPassword(t); setError(''); }}
              secureTextEntry
            />
            <Text style={styles.label}>새 비밀번호 확인</Text>
            <TextInput
              style={[styles.input, confirmPassword && newPassword !== confirmPassword ? styles.inputError : null]}
              placeholder="비밀번호를 다시 입력해주세요"
              placeholderTextColor="#666"
              value={confirmPassword}
              onChangeText={t => { setConfirmPassword(t); setError(''); }}
              secureTextEntry
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <Text style={styles.errorText}>⚠ 비밀번호가 일치하지 않습니다.</Text>
            )}
            {error ? <Text style={styles.errorText}>⚠ {error}</Text> : null}

            <TouchableOpacity
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={saveNewPassword}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>비밀번호 변경하기</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 28, paddingTop: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 30 },
  backText: { color: '#aaa', fontSize: 14 },
  title: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 10 },
  subtitle: { color: '#666', fontSize: 13, lineHeight: 20, marginBottom: 28 },
  tabRow: {
    flexDirection: 'row', backgroundColor: '#16213e',
    borderRadius: 12, padding: 4, marginBottom: 28,
    borderWidth: 1, borderColor: '#0f3460',
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: '#e94560' },
  tabText: { color: '#666', fontSize: 14, fontWeight: 'bold' },
  tabTextActive: { color: '#fff' },
  label: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  input: {
    backgroundColor: '#16213e', color: '#fff', padding: 15,
    borderRadius: 12, marginBottom: 8, fontSize: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  inputError: { borderColor: '#e94560', borderWidth: 1.5 },
  otpInput: { textAlign: 'center', fontSize: 28, fontWeight: 'bold', letterSpacing: 12, color: '#e94560' },
  phoneRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  phonePrefix: {
    backgroundColor: '#16213e', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 15,
    borderWidth: 1, borderColor: '#0f3460', justifyContent: 'center',
  },
  phonePrefixText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  phoneInput: {
    flex: 1, backgroundColor: '#16213e', color: '#fff', padding: 15,
    borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  errorText: { color: '#e94560', fontSize: 12, marginBottom: 10, marginLeft: 2 },
  primaryBtn: {
    backgroundColor: '#e94560', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 8, marginBottom: 14,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  infoBox: {
    backgroundColor: 'rgba(74,158,255,0.08)', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.2)',
  },
  infoText: { color: '#4a9eff', fontSize: 12, lineHeight: 20 },

  // 네이티브 안내 박스
  nativeNoticeBox: {
    backgroundColor: '#16213e', borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: '#0f3460',
  },
  nativeNoticeTitle: { color: '#e94560', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  nativeNoticeText: { color: '#aaa', fontSize: 13, lineHeight: 22, marginBottom: 18 },
  switchEmailBtn: {
    backgroundColor: '#e94560', borderRadius: 12, padding: 14, alignItems: 'center',
  },
  switchEmailBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },

  sentMsg: {
    color: '#aaa', fontSize: 14, lineHeight: 22, marginBottom: 20, textAlign: 'center',
    backgroundColor: '#16213e', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  stepIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#0f3460', borderWidth: 2, borderColor: '#0f3460' },
  stepDotActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  stepDotDone: { backgroundColor: '#4aff91', borderColor: '#4aff91' },
  stepLine: { width: 40, height: 2, backgroundColor: '#0f3460' },
  stepLineDone: { backgroundColor: '#4aff91' },
  stepLabel: { color: '#aaa', fontSize: 11, textAlign: 'center', marginBottom: 20 },
  resendBtn: { alignItems: 'center', paddingVertical: 10 },
  resendText: { color: '#4a9eff', fontSize: 13 },
  doneBox: { alignItems: 'center', paddingTop: 40 },
  doneIcon: { fontSize: 60, marginBottom: 20 },
  doneTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  doneMsg: { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
});
