import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { httpsCallable } from 'firebase/functions';
import { signInWithPhoneNumber, updatePassword, PhoneAuthProvider } from 'firebase/auth';
import * as WebBrowser from 'expo-web-browser';
import { auth, functions } from '../config/firebase';

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

  // 이메일 재설정 플로우에서 코드를 저장해 두었다가 resetPasswordWithCode에 전달
  const [verifiedCode, setVerifiedCode] = useState('');

  // 전화번호 인증 (Firebase Phone Auth)
  const [confirmationResult, setConfirmationResult] = useState(null);
  const recaptchaVerifierRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const clearState = () => { setError(''); setSuccessMsg(''); };

  // 정규화된 전화번호 반환 (+82 형식)
  const normalizePhone = (raw) => {
    let n = raw.trim().replace(/[\s\-()]/g, '');
    if (n.startsWith('0')) n = '+82' + n.slice(1);
    else if (!n.startsWith('+')) n = '+82' + n;
    return n;
  };

  // ── 이메일: 인증 코드 발송 ──────────────────────────────────
  const sendEmailCode = async () => {
    clearState();
    if (!email.trim()) { setError('이메일을 입력해주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('올바른 이메일 형식이 아닙니다.'); return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'sendEmailCode');
      await fn({ email: email.trim(), purpose: 'reset' });
      setStep(STEP.CODE);
    } catch (e) {
      if (e.code === 'functions/not-found') {
        setError('등록되지 않은 이메일입니다.');
      } else if (e.code === 'functions/resource-exhausted') {
        setError('1분 후 다시 요청해주세요.');
      } else if (e.code === 'functions/invalid-argument') {
        setError('올바른 이메일 형식이 아닙니다.');
      } else {
        setError(e.message || '오류가 발생했어요. 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 이메일: 코드 확인 ───────────────────────────────────────
  const verifyEmailCode = async () => {
    clearState();
    if (!otp.trim() || otp.trim().length < 6) {
      setError('6자리 인증 코드를 입력해주세요.'); return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'verifyEmailCode');
      await fn({ email: email.trim(), code: otp.trim() });
      setVerifiedCode(otp.trim());
      setStep(STEP.NEW_PW);
    } catch (e) {
      if (e.code === 'functions/unauthenticated') {
        setError('인증 코드가 올바르지 않아요.');
      } else if (e.code === 'functions/deadline-exceeded') {
        setError('코드가 만료됐어요. 다시 요청해주세요.');
      } else if (e.code === 'functions/failed-precondition') {
        setError('이미 사용된 코드입니다. 다시 요청해주세요.');
      } else if (e.code === 'functions/not-found') {
        setError('인증 코드를 찾을 수 없어요. 다시 요청해주세요.');
      } else {
        setError(e.message || '오류가 발생했어요. 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 전화: 인증 코드 발송 (네이티브: 인앱 브라우저 / 웹: RecaptchaVerifier) ──
  const sendPhoneCode = async () => {
    clearState();
    const trimmed = phone.trim();
    if (!trimmed) { setError('전화번호를 입력해주세요.'); return; }
    const normalized = normalizePhone(trimmed);
    setLoading(true);
    try {
      let result;
      if (Platform.OS === 'web') {
        const { RecaptchaVerifier } = require('firebase/auth');
        if (!recaptchaVerifierRef.current) {
          const container = document.createElement('div');
          document.body.appendChild(container);
          recaptchaVerifierRef.current = new RecaptchaVerifier(auth, container, { size: 'invisible' });
        }
        result = await signInWithPhoneNumber(auth, normalized, recaptchaVerifierRef.current);
        setConfirmationResult(result);
        setStep(STEP.CODE);
        setLoading(false);
        return;
      }
      // 네이티브: 인앱 브라우저로 reCAPTCHA 처리 후 verificationId 수신
      const verifyUrl = `https://pinloger.web.app/phone-verify?phone=${encodeURIComponent(normalized)}&redirect=pinloger%3A%2F%2Fphone-verify-callback`;
      const browserResult = await WebBrowser.openAuthSessionAsync(verifyUrl, 'pinloger://phone-verify-callback');
      if (browserResult.type !== 'success') {
        setError('인증이 취소됐어요. 다시 시도해주세요.');
        setLoading(false);
        return;
      }
      const url = new URL(browserResult.url);
      const vid = url.searchParams.get('verificationId');
      const err = url.searchParams.get('error');
      if (err) { setError(decodeURIComponent(err)); setLoading(false); return; }
      if (!vid) { setError('인증에 실패했어요. 다시 시도해주세요.'); setLoading(false); return; }
      // 네이티브: verificationId 저장 후 코드 입력 단계로
      setConfirmationResult({ verificationId: decodeURIComponent(vid), isNative: true });
      setConfirmationResult(result);
      setStep(STEP.CODE);
    } catch (e) {
      if (e.code === 'auth/invalid-phone-number') {
        setError('올바른 전화번호 형식이 아닙니다.');
      } else if (e.code === 'auth/too-many-requests') {
        setError('요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
      } else {
        setError('SMS 발송에 실패했어요. 이메일로 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 전화: 코드 확인 ─────────────────────────────────────────
  const verifyPhoneCode = async () => {
    clearState();
    if (!otp.trim() || otp.trim().length < 6) {
      setError('6자리 인증 코드를 입력해주세요.'); return;
    }
    setLoading(true);
    try {
      let user;
      if (confirmationResult?.isNative) {
        // 네이티브: verificationId + 코드로 signInWithCredential
        const { signInWithCredential } = require('firebase/auth');
        const credential = PhoneAuthProvider.credential(confirmationResult.verificationId, otp.trim());
        const userCredential = await signInWithCredential(auth, credential);
        user = userCredential.user;
      } else {
        // 웹: ConfirmationResult.confirm()
        const userCredential = await confirmationResult.confirm(otp.trim());
        user = userCredential.user;
      }
      if (!user.email) {
        await user.delete();
        setError('이 번호로 등록된 계정이 없어요. 이메일로 시도해주세요.');
        setStep(STEP.INPUT);
        return;
      }
      setStep(STEP.NEW_PW);
    } catch (e) {
      if (e.code === 'auth/invalid-verification-code') {
        setError('인증 코드가 올바르지 않아요.');
      } else if (e.code === 'auth/code-expired') {
        setError('코드가 만료됐어요. 다시 요청해주세요.');
      } else {
        setError(e.message || '인증에 실패했어요.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── 새 비밀번호 저장 ────────────────────────────────────────
  const saveNewPassword = async () => {
    clearState();
    if (!newPassword) { setError('새 비밀번호를 입력해주세요.'); return; }
    if (newPassword.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (newPassword !== confirmPassword) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    try {
      if (tab === 'phone') {
        // 이미 signInWithPhoneNumber로 로그인됨
        await updatePassword(auth.currentUser, newPassword);
      } else {
        const fn = httpsCallable(functions, 'resetPasswordWithCode');
        await fn({ target: email.trim(), type: 'email', code: verifiedCode, newPassword });
      }
      setStep(STEP.DONE);
      setSuccessMsg('비밀번호가 성공적으로 변경됐어요!\n새 비밀번호로 로그인해주세요.');
    } catch (e) {
      if (e.code === 'auth/requires-recent-login') {
        setError('보안을 위해 다시 인증해주세요.');
      } else if (e.code === 'functions/unauthenticated') {
        setError('인증 코드가 올바르지 않아요.');
      } else {
        setError(e.message || '비밀번호 변경 중 오류가 발생했어요.');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setStep(STEP.INPUT);
    setEmail(''); setPhone(''); setOtp('');
    setNewPassword(''); setConfirmPassword('');
    setError(''); setSuccessMsg('');
    setVerifiedCode('');
    setConfirmationResult(null);
  };

  const switchTab = (t) => { setTab(t); resetAll(); };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
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

        {/* 탭 — INPUT 단계에서만 표시 */}
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
            <Text style={styles.doneTitle}>비밀번호 변경 완료!</Text>
            <Text style={styles.doneMsg}>{successMsg}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.primaryBtnText}>로그인 화면으로</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 이메일 탭 - STEP 1: 이메일 입력 ── */}
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
              onPress={sendEmailCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>인증 코드 받기</Text>
              }
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                📌 입력한 이메일로 6자리 인증 코드가 발송됩니다.{'\n'}
                스팸 메일함도 확인해보세요. (10분 유효)
              </Text>
            </View>
          </View>
        )}

        {/* ── 이메일 탭 - STEP 2: 코드 입력 ── */}
        {tab === 'email' && step === STEP.CODE && (
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
              📧 {email.trim()}으로{'\n'}6자리 인증 코드를 발송했어요.
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
              onPress={verifyEmailCode}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>코드 확인</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.resendBtn} onPress={resetAll}>
              <Text style={styles.resendText}>코드를 받지 못했나요? 다시 요청</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 이메일 탭 - STEP 3: 새 비밀번호 ── */}
        {tab === 'email' && step === STEP.NEW_PW && (
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

        {/* ── 전화번호 탭 - STEP 1: 전화번호 입력 ── */}
        {tab === 'phone' && step === STEP.INPUT && (
          <View>
            <Text style={styles.label}>가입한 전화번호</Text>
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
                📌 Firebase를 통해 SMS로 인증 코드가 발송됩니다.{'\n'}
                등록한 전화번호로 인증 후 비밀번호를 재설정할 수 있어요. (10분 유효){'\n\n'}
                전화번호 인증이 어려운 경우 이메일 탭을 이용해주세요.
              </Text>
            </View>
          </View>
        )}

        {/* ── 전화번호 탭 - STEP 2: 코드 입력 ── */}
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
              📱 {phone}으로{'\n'}6자리 인증 코드를 발송했어요.
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
              onPress={verifyPhoneCode}
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
