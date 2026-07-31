/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '../src/components/ui/ThemedText';
import {
  resolveEmbeddedLegalDocuments,
  type LegalDocumentId,
} from '../src/constants/legalDocuments';
import { useThemeColor } from '../src/hooks/useThemeColor';

export default function LegalScreen() {
  const { t } = useTranslation();
  const [activeDocument, setActiveDocument] = useState<LegalDocumentId>('notice');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const documents = useMemo(
    () => resolveEmbeddedLegalDocuments(Constants.expoConfig?.extra as Record<string, unknown> | undefined),
    []
  );

  const entries: { id: LegalDocumentId; label: string }[] = [
    { id: 'notice', label: t('settings.legal.notice') },
    { id: 'license', label: t('settings.legal.apacheLicense') },
    { id: 'thirdPartyNotices', label: t('settings.legal.thirdPartyNotices') },
    { id: 'privacy', label: t('settings.legal.privacyPolicy') },
    { id: 'terms', label: t('settings.legal.termsOfService') },
  ];

  return (
    <>
      <Stack.Screen options={{ title: t('settings.legal.title') }} />
      <View style={styles.container}>
        <View style={[styles.tabs, { borderBottomColor: border, backgroundColor: surface }]}>
          {entries.map((entry) => {
            const active = activeDocument === entry.id;
            return (
              <TouchableOpacity
                key={entry.id}
                accessibilityRole='tab'
                accessibilityState={{ selected: active }}
                style={[styles.tab, active && { borderBottomColor: tint }]}
                onPress={() => setActiveDocument(entry.id)}
              >
                <ThemedText type='caption' style={active ? { color: tint, fontWeight: '600' } : undefined}>
                  {entry.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
        <ScrollView contentContainerStyle={styles.documentContent}>
          <ThemedText selectable style={styles.documentText}>
            {documents[activeDocument] || t('settings.legal.unavailable')}
          </ThemedText>
        </ScrollView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    minWidth: '33.333%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  documentContent: {
    padding: 18,
  },
  documentText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 19,
  },
});
