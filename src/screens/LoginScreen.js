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
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AuthSession from 'expo-auth-session';
import { auth, functions } from '../config/firebase';
import { GOOGLE_WEB_CLIENT_ID, EXPO_USERNAME } from '../config/socialAuth';

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
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '' });

  // 고정 redirect URI — ngrok 터널 URL은 매번 바뀌므로 Expo 프록시 고정 URL 사용
  const redirectUri = `https://auth.expo.io/@${EXPO_USERNAME}/TravelApp`;

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: GOOGLE_WEB_CLIENT_ID,      // Expo Go 범용 fallback
    webClientId: GOOGLE_WEB_CLIENT_ID,
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
    setFieldErrors({ email: '', password: '' });
  };

  const validate = () => {
    const errs = { email: '', password: '' };
    let valid = true;
    if (!email.trim()) { errs.email = '이메일을 입력해주세요.'; valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = '올바른 이메일 형식이 아닙니다.'; valid = false;
    }
    if (!password) { errs.password = '비밀번호를 입력해주세요.'; valid = false; }
    else if (isSignUp && password.length < 6) {
      errs.password = '비밀번호는 6자 이상이어야 합니다.'; valid = false;
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
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      const msg = AUTH_ERRORS[error.code] || '오류가 발생했어요. 다시 시도해주세요.';
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        setFieldErrors(prev => ({ ...prev, password: msg }));
      } else if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
        setFieldErrors(prev => ({ ...prev, email: msg }));
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // 카카오 로그인
  const handleKakaoLogin = async () => {
    clearErrors();
    setLoading(true);
    try {
      // 카카오 인가 URL — client_id는 인가 URL 구성에만 사용 (토큰 교환은 서버에서)
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

      // URL에서 code 파싱
      const urlParts = result.url.split('?');
      if (urlParts.length < 2) throw new Error('code not found');
      const params = {};
      urlParts[1].split('&').forEach(pair => {
        const [key, val] = pair.split('=');
        params[key] = decodeURIComponent(val || '');
      });
      const code = params.code;
      if (!code) throw new Error('code not found');

      // Cloud Function 호출 — API 키는 서버에서만 사용
      const kakaoLoginFn = httpsCallable(functions, 'kakaoLogin');
      const { data } = await kakaoLoginFn({ code, redirectUri });

      // Firebase Custom Token으로 로그인
      await signInWithCustomToken(auth, data.customToken);
    } catch (err) {
      setErrorMsg('카카오 로그인 중 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const isGoogleEnabled = GOOGLE_WEB_CLIENT_ID !== 'YOUR_GOOGLE_WEB_CLIENT_ID';
  const isKakaoEnabled = true; // API 키는 Cloud Function 서버에서 관리

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
            : <Text style={styles.buttonText}>{isSignUp ? '회원가입' : '로그인'}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); clearErrors(); }}>
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
          style={[styles.socialBtn, !isGoogleEnabled && styles.socialBtnDisabled]}
          onPress={() => {
            clearErrors();
            if (isGoogleEnabled) {
              promptAsync();
            } else {
              setErrorMsg('Google 클라이언트 ID를 설정해주세요.');
            }
          }}
          disabled={!request}
        >
          <GoogleLogo />
          <Text style={styles.socialBtnText}>Google로 계속하기</Text>
        </TouchableOpacity>

        {/* 카카오 로그인 */}
        <TouchableOpacity
          style={[styles.kakaoBtn, (!isKakaoEnabled || loading) && styles.socialBtnDisabled]}
          onPress={handleKakaoLogin}
          disabled={!isKakaoEnabled || loading}
        >
          <KakaoLogo />
          <Text style={styles.kakaoBtnText}>카카오로 계속하기</Text>
        </TouchableOpacity>

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
});
