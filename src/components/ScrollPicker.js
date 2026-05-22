import React, { useRef, useEffect } from 'react';
import { View, ScrollView, Text, StyleSheet } from 'react-native';

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

export default function ScrollPicker({ items, selectedValue, onValueChange, width = 80 }) {
  const scrollRef = useRef(null);
  const selectedIndex = items.indexOf(selectedValue);

  useEffect(() => {
    if (scrollRef.current && selectedIndex >= 0) {
      scrollRef.current.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    }
  }, [selectedValue]); // selectedValue 변경 시 스크롤 위치 동기화

  const handleScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const index = Math.round(y / ITEM_HEIGHT);
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    if (items[clamped] !== selectedValue) {
      onValueChange(items[clamped]);
    }
  };

  return (
    <View style={[styles.container, { width }]}>
      <View style={styles.selector} pointerEvents="none" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScroll}
        contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
      >
        {items.map((item, i) => (
          <View key={i} style={styles.item}>
            <Text style={[styles.itemText, item === selectedValue && styles.selectedText]}>
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    overflow: 'hidden',
  },
  selector: {
    position: 'absolute',
    top: ITEM_HEIGHT * 2,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#e94560',
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    color: '#666',
    fontSize: 16,
  },
  selectedText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
