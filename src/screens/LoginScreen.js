import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithCredential, signInWithCustomToken,
  signInWithPopup,
} from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { doc, setDoc } from 'firebase/firestore';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AuthSession from 'expo-auth-session';
import { auth, functions, db } from '../config/firebase';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, EXPO_USERNAME } from '../config/socialAuth';

WebBrowser.maybeCompleteAuthSession();

const AUTH_ERRORS = {
  'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
  'auth/invalid-email': '올바른 이메일 형식이 아닙니다.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/user-not-found': '등록된 계정이 없습니다. 이메일을 확인해주세요.',
  'auth/wrong-password': '비밀번호가 틀렸습니다. 다시 확인해주세요.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/user-disabled': '사용이 정지된 계정입니다.',
  'auth/too-many-requests': '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
  'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
};

// Google "G" 로고 컴포넌트
function GoogleLogo() {
  return (
    <View style={gStyles.container}>
      <View style={gStyles.gBlue}><Text style={gStyles.gText}>G</Text></View>
    </View>
  );
}

const gStyles = StyleSheet.create({
  container: {
    width: 26, height: 26,
    backgroundColor: '#fff',
    borderRadius: 4,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  },
  gBlue: { justifyContent: 'center', alignItems: 'center' },
  gText: { color: '#4285F4', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
});

// 카카오 로고 컴포넌트
function KakaoLogo() {
  return (
    <View style={kStyles.container}>
      <Text style={kStyles.text}>K</Text>
    </View>
  );
}

const kStyles = StyleSheet.create({
  container: {
    width: 26, height: 26,
    backgroundColor: '#3C1E1E',
    borderRadius: 4,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  text: { color: '#FEE500', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
});

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [signupStep, setSignupStep] = useState('form'); // 'form' | 'verify'
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '', nickname: '' });

  // Expo Go + 프로덕션 빌드 공통 redirect URI
  const redirectUri = `https://auth.expo.io/@${EXPO_USERNAME}/TravelApp`;

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    redirectUri,
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential).catch(() => {
        setErrorMsg('Google 로그인에 실패했어요. 잠시 후 다시 시도해주세요.');
      });
    } else if (response?.type === 'error') {
      setErrorMsg('Google 로그인 중 오류가 발생했어요.');
    }
  }, [response]);

  const clearErrors = () => {
    setErrorMsg('');
    setFieldErrors({ email: '', password: '', nickname: '' });
  };

  const validate = () => {
    const errs = { email: '', password: '', nickname: '' };
    let valid = true;
    if (!email.trim()) { errs.email = '이메일을 입력해주세요.'; valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = '올바른 이메일 형식이 아닙니다.'; valid = false;
    }
    if (!password) { errs.password = '비밀번호를 입력해주세요.'; valid = false; }
    else if (isSignUp && password.length < 6) {
      errs.password = '비밀번호는 6자 이상이어야 합니다.'; valid = false;
    }
    if (isSignUp) {
      if (!nickname.trim()) { errs.nickname = '닉네임을 입력해주세요.'; valid = false; }
      else if (nickname.trim().length < 2) { errs.nickname = '닉네임은 2자 이상이어야 합니다.'; valid = false; }
      else if (nickname.trim().length > 12) { errs.nickname = '닉네임은 12자 이하여야 합니다.'; valid = false; }
    }
    setFieldErrors(errs);
    return valid;
  };

  const handleEmailAuth = async () => {
    clearErrors();
    if (!validate()) return;

    setLoading(true);
    try {
      if (isSignUp) {
        // 닉네임 중복 체크
        const checkFn = httpsCallable(functions, 'checkAvailability');
        const { data: checkData } = await checkFn({ type: 'nickname', value: nickname.trim() });
        if (!checkData.available) {
          setFieldErrors(prev => ({ ...prev, nickname: '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해주세요.' }));
          setLoading(false);
          return;
        }

        // 이메일 인증 코드 발송
        const sendCodeFn = httpsCallable(functions, 'sendEmailCode');
        await sendCodeFn({ email: email.trim(), purpose: 'signup' });
        setSignupStep('verify');
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      // Cloud Function 에러 처리
      if (error.code === 'functions/already-exists') {
        setFieldErrors(prev => ({ ...prev, email: '이미 사용 중인 이메일입니다.' }));
      } else if (error.code === 'functions/resource-exhausted') {
        setErrorMsg('1분 후 다시 요청해주세요.');
      } else {
        const msg = AUTH_ERRORS[error.code] || error.message || '오류가 발생했어요. 다시 시도해주세요.';
        if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
          setFieldErrors(prev => ({ ...prev, password: msg }));
        } else if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
          setFieldErrors(prev => ({ ...prev, email: msg }));
        } else {
          setErrorMsg(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndSignup = async () => {
    clearErrors();
    if (!verifyCode.trim() || verifyCode.trim().length < 6) {
      setErrorMsg('6자리 인증 코드를 입력해주세요.');
      return;
    }

    setVerifyLoading(true);
    try {
      // 이메일 코드 확인
      const verifyFn = httpsCallable(functions, 'verifyEmailCode');
      await verifyFn({ email: email.trim(), code: verifyCode.trim() });

      // 계정 생성
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = userCredential.user.uid;

      // Firestore에 닉네임 저장
      await setDoc(doc(db, 'users', uid), {
        nickname: nickname.trim(),
        email: email.trim(),
        provider: 'password',
        avatar: '✈️',
        createdAt: new Date(),
      }, { merge: true });

    } catch (error) {
      if (error.code === 'functions/not-found') {
        setErrorMsg('인증 코드를 찾을 수 없어요. 다시 요청해주세요.');
      } else if (error.code === 'functions/failed-precondition') {
        setErrorMsg('이미 사용된 코드입니다. 다시 요청해주세요.');
      } else if (error.code === 'functions/deadline-exceeded') {
        setErrorMsg('코드가 만료됐어요. 다시 요청해주세요.');
      } else if (error.code === 'functions/unauthenticated') {
        setErrorMsg('인증 코드가 올바르지 않아요.');
      } else {
        const msg = AUTH_ERRORS[error.code] || error.message || '오류가 발생했어요. 다시 시도해주세요.';
        setErrorMsg(msg);
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleResendCode = async () => {
    clearErrors();
    setVerifyLoading(true);
    try {
      const sendCodeFn = httpsCallable(functions, 'sendEmailCode');
      await sendCodeFn({ email: email.trim(), purpose: 'signup' });
      setErrorMsg('');
      setVerifyCode('');
    } catch (error) {
      if (error.code === 'functions/resource-exhausted') {
        setErrorMsg('1분 후 다시 요청해주세요.');
      } else {
        setErrorMsg('코드 재발송에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  // 카카오 로그인
  const handleKakaoLogin = async () => {
    clearErrors();
    setLoading(true);
    try {
      const KAKAO_CLIENT_ID = 'a3d59f0ee5ce613e9e2c7b77ca7fbc04';
      const kakaoAuthUrl =
        `https://kauth.kakao.com/oauth/authorize` +
        `?client_id=${KAKAO_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code`;

      const result = await WebBrowser.openAuthSessionAsync(kakaoAuthUrl, redirectUri);

      if (result.type !== 'success') {
        setLoading(false);
        return;
      }

      const urlParts = result.url.split('?');
      if (urlParts.length < 2) throw new Error('code not found');
      const params = {};
      urlParts[1].split('&').forEach(pair => {
        const [key, val] = pair.split('=');
        params[key] = decodeURIComponent(val || '');
      });
      const code = params.code;
      if (!code) throw new Error('code not found');

      const kakaoLoginFn = httpsCallable(functions, 'kakaoLogin');
      const { data } = await kakaoLoginFn({ code, redirectUri });

      await signInWithCustomToken(auth, data.customToken);
    } catch (err) {
      setErrorMsg('카카오 로그인 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const isGoogleEnabled = GOOGLE_WEB_CLIENT_ID !== 'YOUR_GOOGLE_WEB_CLIENT_ID';
  const isKakaoEnabled = Platform.OS !== 'web';

  const handleGoogleLogin = async () => {
    clearErrors();
    if (Platform.OS === 'web') {
      setLoading(true);
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
          setErrorMsg('Google 로그인에 실패했어요. 잠시 후 다시 시도해주세요.');
        }
      } finally {
        setLoading(false);
      }
    } else {
      if (isGoogleEnabled) {
        promptAsync();
      } else {
        setErrorMsg('Google 클라이언트 ID를 설정해주세요.');
      }
    }
  };

  // ── 이메일 인증 화면 (회원가입 2단계) ──────────────────────────
  if (isSignUp && signupStep === 'verify') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.logo}>📍 PINLOGER</Text>
          <Text style={styles.subtitle}>이메일 인증</Text>

          <View style={styles.verifyInfoBox}>
            <Text style={styles.verifyInfoText}>
              📧 {email.trim()}로{'\n'}인증 코드를 보냈어요.{'\n'}메일함을 확인해주세요. (10분 유효)
            </Text>
          </View>

          <TextInput
            style={[styles.input, styles.codeInput, errorMsg ? styles.inputError : null]}
            placeholder="000000"
            placeholderTextColor="#555"
            value={verifyCode}
            onChangeText={t => { setVerifyCode(t.replace(/[^0-9]/g, '').slice(0, 6)); setErrorMsg(''); }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>⚠ {errorMsg}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.button, verifyLoading && styles.buttonDisabled]}
            onPress={handleVerifyAndSignup}
            disabled={verifyLoading}
          >
            {verifyLoading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>인증하고 가입하기</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              setSignupStep('form');
              setVerifyCode('');
              clearErrors();
            }}
          >
            <Text style={styles.backBtnText}>← 뒤로</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResendCode}
            disabled={verifyLoading}
          >
            <Text style={styles.resendBtnText}>코드 재발송</Text>
          </TouchableOpacity>

        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── 기본 로그인/회원가입 폼 ──────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.logo}>📍 PINLOGER</Text>
        <Text style={styles.subtitle}>{isSignUp ? '회원가입' : '로그인'}</Text>

        {/* 이메일 입력 */}
        <TextInput
          style={[styles.input, fieldErrors.email ? styles.inputError : null]}
          placeholder="이메일"
          placeholderTextColor="#aaa"
          value={email}
          onChangeText={t => { setEmail(t); setFieldErrors(p => ({ ...p, email: '' })); setErrorMsg(''); }}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {fieldErrors.email ? (
          <Text style={styles.fieldErrorText}>⚠ {fieldErrors.email}</Text>
        ) : null}

        {/* 회원가입 시 닉네임 입력 */}
        {isSignUp && (
          <>
            <TextInput
              style={[styles.input, fieldErrors.nickname ? styles.inputError : null]}
              placeholder="닉네임 (2~12자)"
              placeholderTextColor="#aaa"
              value={nickname}
              onChangeText={t => { setNickname(t); setFieldErrors(p => ({ ...p, nickname: '' })); setErrorMsg(''); }}
              autoCapitalize="none"
              maxLength={12}
            />
            {fieldErrors.nickname ? (
              <Text style={styles.fieldErrorText}>⚠ {fieldErrors.nickname}</Text>
            ) : null}
          </>
        )}

        {/* 비밀번호 입력 */}
        <TextInput
          style={[styles.input, fieldErrors.password ? styles.inputError : null]}
          placeholder="비밀번호 (6자 이상)"
          placeholderTextColor="#aaa"
          value={password}
          onChangeText={t => { setPassword(t); setFieldErrors(p => ({ ...p, password: '' })); setErrorMsg(''); }}
          secureTextEntry
        />
        {fieldErrors.password ? (
          <Text style={styles.fieldErrorText}>⚠ {fieldErrors.password}</Text>
        ) : null}

        {/* 공통 오류 메시지 */}
        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxText}>⚠ {errorMsg}</Text>
          </View>
        ) : null}

        {/* 로그인/회원가입 버튼 */}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleEmailAuth}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>{isSignUp ? '인증 메일 받기' : '로그인'}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => {
          setIsSignUp(!isSignUp);
          setSignupStep('form');
          setVerifyCode('');
          setNickname('');
          clearErrors();
        }}>
          <Text style={styles.toggleText}>
            {isSignUp ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입'}
          </Text>
        </TouchableOpacity>

        {!isSignUp && (
          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={styles.forgotText}>비밀번호를 잊으셨나요?</Text>
          </TouchableOpacity>
        )}

        {/* 구분선 */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Google 로그인 */}
        <TouchableOpacity
          style={[styles.socialBtn, loading && styles.socialBtnDisabled]}
          onPress={handleGoogleLogin}
          disabled={loading || (Platform.OS !== 'web' && !request)}
        >
          <GoogleLogo />
          <Text style={styles.socialBtnText}>Google로 계속하기</Text>
        </TouchableOpacity>

        {/* 카카오 로그인 — 네이티브 전용 */}
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            style={[styles.kakaoBtn, loading && styles.socialBtnDisabled]}
            onPress={handleKakaoLogin}
            disabled={loading}
          >
            <KakaoLogo />
            <Text style={styles.kakaoBtnText}>카카오로 계속하기</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 40 },
  logo: { fontSize: 34, textAlign: 'center', marginBottom: 8, color: '#fff' },
  subtitle: { fontSize: 20, textAlign: 'center', color: '#aaa', marginBottom: 36 },

  input: {
    backgroundColor: '#16213e', color: '#fff', padding: 15, borderRadius: 12,
    marginBottom: 4, fontSize: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  inputError: {
    borderColor: '#e94560', borderWidth: 1.5,
  },
  codeInput: {
    textAlign: 'center', fontSize: 32, fontWeight: 'bold',
    letterSpacing: 12, color: '#e94560', marginBottom: 16,
  },
  fieldErrorText: {
    color: '#e94560', fontSize: 12, marginBottom: 10, marginLeft: 4,
  },

  errorBox: {
    backgroundColor: 'rgba(233,69,96,0.12)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)',
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12,
  },
  errorBoxText: {
    color: '#e94560', fontSize: 13, lineHeight: 18,
  },

  button: {
    backgroundColor: '#e94560', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 8, marginBottom: 18,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  toggleText: { color: '#aaa', textAlign: 'center', fontSize: 14 },
  forgotBtn: { alignItems: 'center', marginTop: 12 },
  forgotText: { color: '#4a9eff', fontSize: 13 },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#0f3460' },
  dividerText: { color: '#aaa', marginHorizontal: 14, fontSize: 13 },

  socialBtn: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#0f3460', marginBottom: 10,
  },
  socialBtnDisabled: { opacity: 0.5 },
  socialBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  kakaoBtn: {
    backgroundColor: '#FEE500', borderRadius: 12, padding: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  kakaoBtnText: { color: '#3C1E1E', fontSize: 16, fontWeight: 'bold' },

  // 이메일 인증 화면 전용
  verifyInfoBox: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 20,
    borderWidth: 1, borderColor: '#0f3460', marginBottom: 24,
  },
  verifyInfoText: {
    color: '#aaa', fontSize: 14, lineHeight: 22, textAlign: 'center',
  },
  backBtn: { alignItems: 'center', marginBottom: 14 },
  backBtnText: { color: '#aaa', fontSize: 14 },
  resendBtn: { alignItems: 'center', paddingVertical: 8 },
  resendBtnText: { color: '#4a9eff', fontSize: 13 },
});
