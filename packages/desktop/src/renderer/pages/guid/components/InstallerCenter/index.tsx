import winkGoWordmark from '@/renderer/assets/brand/wink-go-wordmark.png';
import antigravityLogo from '@/renderer/assets/product-logos/antigravity.png';
import claudeLogo from '@/renderer/assets/product-logos/claude.png';
import codexLogo from '@/renderer/assets/product-logos/codex.svg';
import { Button, Message, Modal, Tag } from '@arco-design/web-react';
import { Apple, DownloadOne, Windows } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isMacOS } from '@/renderer/utils/platform';
import { openExternalUrl } from '@/renderer/utils/platform';
import styles from './InstallerCenter.module.css';
import {
  getInstallerGroups,
  isTrustedInstallerUrl,
  type InstallerItem,
  type InstallerProduct,
  type InstallerTone,
} from './installerCatalog';

type InstallerCenterProps = {
  visible: boolean;
  onCancel: () => void;
};

const PRODUCT_LOGOS: Record<InstallerProduct, string> = {
  codex: codexLogo,
  claude: claudeLogo,
  antigravity: antigravityLogo,
};

const PRODUCT_LOGO_SHAPES: Record<InstallerProduct, string> = {
  codex: styles.logoCodex,
  claude: styles.logoRounded,
  antigravity: styles.logoSquare,
};

const TONE_CLASSES: Record<InstallerTone, string> = {
  orange: styles.toneOrange,
  indigo: styles.toneIndigo,
  pink: styles.tonePink,
};

const InstallerCenter: React.FC<InstallerCenterProps> = ({ visible, onCancel }) => {
  const { t } = useTranslation();
  const preferredPlatform = isMacOS() ? 'macos' : 'windows';
  const groups = useMemo(() => getInstallerGroups(preferredPlatform), [preferredPlatform]);

  const handleDownload = async (installer: InstallerItem) => {
    if (!isTrustedInstallerUrl(installer.downloadUrl)) {
      Message.error(t('guid.installerCenter.downloadFailed'));
      return;
    }

    try {
      await openExternalUrl(installer.downloadUrl);
    } catch (error) {
      console.error('[InstallerCenter] Failed to open installer URL:', error);
      Message.error(t('guid.installerCenter.downloadFailed'));
    }
  };

  return (
    <Modal
      className={styles.modal}
      visible={visible}
      title={null}
      footer={null}
      onCancel={onCancel}
      maskClosable
      unmountOnExit
      style={{ overflow: 'hidden', borderRadius: 20, background: 'var(--color-fill-1)' }}
    >
      <div className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <img className={styles.brandWordmark} src={winkGoWordmark} alt='WINK GO' />
            <h2 className={styles.heroTitle}>{t('guid.installerCenter.title')}</h2>
            <p className={styles.heroSubtitle}>{t('guid.installerCenter.subtitle')}</p>
          </div>
          <div className={styles.heroProductLogos} aria-hidden='true'>
            {(['codex', 'claude', 'antigravity'] as const).map((product) => (
              <span className={`${styles.heroProductLogo} ${PRODUCT_LOGO_SHAPES[product]}`} key={product}>
                <img src={PRODUCT_LOGOS[product]} alt='' />
              </span>
            ))}
          </div>
        </section>

        <div className={styles.body}>
          {groups.map((group) => {
            const isWindows = group.platform === 'windows';
            const PlatformIcon = isWindows ? Windows : Apple;
            const platformLabel = t(isWindows ? 'guid.installerCenter.windows' : 'guid.installerCenter.macos');

            return (
              <section className={styles.platformSection} key={group.platform}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitle}>
                    <PlatformIcon theme='outline' size='20' fill='currentColor' />
                    <span>{platformLabel}</span>
                  </div>
                  {group.platform === preferredPlatform ? (
                    <Tag color='arcoblue'>{t('guid.installerCenter.recommended')}</Tag>
                  ) : null}
                </div>

                <div className={styles.cardGrid}>
                  {group.installers.map((installer) => {
                    const packageType = isWindows ? '.EXE' : '.DMG';
                    return (
                      <article className={`${styles.installerCard} ${TONE_CLASSES[installer.tone]}`} key={installer.id}>
                        <div className={styles.cardHeader}>
                          <span
                            className={`${styles.productLogoFrame} ${PRODUCT_LOGO_SHAPES[installer.product]}`}
                            aria-hidden='true'
                          >
                            <img className={styles.productLogo} src={PRODUCT_LOGOS[installer.product]} alt='' />
                          </span>
                          <span className={styles.packageType}>{packageType}</span>
                        </div>
                        <div className={styles.cardCopy}>
                          <strong>{installer.productName}</strong>
                          <span>
                            {t('guid.installerCenter.environmentSetup', {
                              platform: platformLabel,
                            })}
                          </span>
                        </div>
                        <Button
                          className={styles.downloadButton}
                          type='primary'
                          icon={<DownloadOne theme='outline' size='16' fill='currentColor' />}
                          onClick={() => void handleDownload(installer)}
                        >
                          {t('common.download')}
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default InstallerCenter;
