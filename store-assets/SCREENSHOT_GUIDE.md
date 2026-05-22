# 앱스토어 스크린샷 가이드

## 필수 사이즈
| 기기 | 해상도 | 필수 여부 |
|------|--------|---------|
| 6.9인치 (iPhone 16 Plus) | 1320 × 2868 px | ✅ 필수 |
| 6.5인치 (iPhone 11 Pro Max) | 1242 × 2688 px | ✅ 필수 |
| 5.5인치 (iPhone 8 Plus) | 1242 × 2208 px | ✅ 필수 |

각 사이즈별 최소 1장, 최대 10장

## 권장 스크린샷 구성 (5장)

| 순서 | 화면 | 설명 |
|------|------|------|
| 1 | 홈 (내 여행 목록) | 여행 카드들이 보이는 메인 화면 |
| 2 | 여행 상세 (일정 탭) | 날짜별 일정 목록 |
| 3 | 비용 탭 | 지출 내역 및 정산 |
| 4 | 지갑 탭 | 환전 내역 및 잔액 |
| 5 | 새 여행 만들기 모달 | 목적지 입력 + 국기 자동 감지 |

## 캡처 방법

### Expo Go / 시뮬레이터에서 캡처
```bash
# iOS 시뮬레이터 실행
npx expo start --ios

# 시뮬레이터에서 Cmd+S → 스크린샷 저장
```

### 실제 기기에서 캡처
- 사이드 버튼 + 볼륨업 버튼 동시 클릭

## 파일 명명 규칙
```
screenshot_01_home.png
screenshot_02_schedule.png
screenshot_03_cost.png
screenshot_04_wallet.png
screenshot_05_new_trip.png
```

이 폴더에 저장: `store-assets/screenshots/`
