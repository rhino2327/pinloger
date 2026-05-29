import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc } from 'firebase/firestore';
import { auth, functions, db } from '../config/firebase';

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

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ email: '', password: '', nickname: '' });

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
        const checkFn = httpsCallable(functions, 'checkAvailability');
        const { data: checkData } = await checkFn({ type: 'nickname', value: nickname.trim() });
        if (!checkData.available) {
          setFieldErrors(prev => ({ ...prev, nickname: '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해주세요.' }));
          setLoading(false);
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const uid = userCredential.user.uid;
        await setDoc(doc(db, 'users', uid), {
          nickname: nickname.trim(),
          email: email.trim(),
          provider: 'password',
          avatar: '✈️',
          createdAt: new Date(),
        }, { merge: true });
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      const msg = AUTH_ERRORS[error.code] || error.message || '오류가 발생했어요. 다시 시도해주세요.';
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

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxText}>⚠ {errorMsg}</Text>
          </View>
        ) : null}

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

        <TouchableOpacity onPress={() => {
          setIsSignUp(!isSignUp);
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
  inputError: { borderColor: '#e94560', borderWidth: 1.5 },
  fieldErrorText: { color: '#e94560', fontSize: 12, marginBottom: 10, marginLeft: 4 },

  errorBox: {
    backgroundColor: 'rgba(233,69,96,0.12)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)',
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12,
  },
  errorBoxText: { color: '#e94560', fontSize: 13, lineHeight: 18 },

  button: {
    backgroundColor: '#e94560', padding: 16, borderRadius: 12,
    alignItems: 'center', marginTop: 8, marginBottom: 18,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  toggleText: { color: '#aaa', textAlign: 'center', fontSize: 14 },
  forgotBtn: { alignItems: 'center', marginTop: 12 },
  forgotText: { color: '#4a9eff', fontSize: 13 },
});
