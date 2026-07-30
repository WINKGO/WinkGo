import antigravityLogo from '@/renderer/assets/product-logos/antigravity.png';
import claudeLogo from '@/renderer/assets/product-logos/claude.png';
import codexLogo from '@/renderer/assets/product-logos/codex.svg';
import weixinLogo from '@/renderer/assets/channel-logos/weixin.svg';
import React from 'react';

interface WinkGoSkillBrandIconProps {
  skillId: string;
  displayName: string;
}

const imageLogos: Record<string, string> = {
  claude: claudeLogo,
  codex: codexLogo,
  google_antigravity: antigravityLogo,
  wechat: weixinLogo,
};

const BrandSvg: React.FC<{ children: React.ReactNode; viewBox?: string }> = ({ children, viewBox = '0 0 48 48' }) => (
  <svg aria-hidden='true' className='h-full w-full' viewBox={viewBox} xmlns='http://www.w3.org/2000/svg'>
    {children}
  </svg>
);

const VectorBrandIcon: React.FC<{ skillId: string }> = ({ skillId }) => {
  switch (skillId) {
    case 'netease_music':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#E83C3C' />
          <path
            d='M25.1 10.5c-7 1.9-12 8.2-12.4 15.7-.5 7.8 3.5 15 10.1 18.2 7.4 3.6 14.2 1.3 18-2.2 3.3-3 5-7.3 4.3-11.2-.8-4.6-3.7-8.1-7.8-9.5-1.7-.6-3.5-.7-5.2-.4-.6-2.2-1.2-4.5-1.1-6.6.1-1.5 1.3-2 2.5-2.1 1.8-.1 3.8.7 4.6 2'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeWidth='3.2'
          />
          <path
            d='M30.1 23.4c-5.9 1.6-10.2 5.8-10.3 10.1-.1 4.5 3.2 7.7 7.2 7.6 4-.1 7.1-3.3 6.9-7.3-.1-2-1.9-7.1-3.8-10.4Z'
            fill='none'
            stroke='#fff'
            strokeLinejoin='round'
            strokeWidth='3.2'
          />
        </BrandSvg>
      );
    case 'qq_music':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#16C76A' />
          <circle cx='23' cy='27' r='11.5' fill='#fff' />
          <circle cx='23' cy='27' r='5.2' fill='#16C76A' />
          <path d='M28 10.5v19.2a5.2 5.2 0 1 1-3-4.7V13l12-2.5v5.4L28 18Z' fill='#FFE238' />
        </BrandSvg>
      );
    case 'soda_music':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='sodaMusicGradient' x1='7' y1='42' x2='42' y2='7' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#FF357B' />
              <stop offset='1' stopColor='#FF7A3D' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#sodaMusicGradient)' />
          <path
            d='M30.5 12.5v19.4a6.4 6.4 0 1 1-3.6-5.7V16.3l9.1-2v5l-5.5 1.2'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='4'
          />
          <circle cx='16' cy='16' r='3' fill='#fff' fillOpacity='.9' />
        </BrandSvg>
      );
    case 'windows':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#F3F8FF' />
          <path
            d='m7 10 15-2v15H7V10Zm18-2.4 16-2.2V23H25V7.6ZM7 26h15v15L7 39V26Zm18 0h16v17.6l-16-2.2V26Z'
            fill='#087CD8'
          />
        </BrandSvg>
      );
    case 'web_automation':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='webAutoGradient' x1='9' y1='8' x2='39' y2='41' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#2F7BFF' />
              <stop offset='.55' stopColor='#1BB7C5' />
              <stop offset='1' stopColor='#6B4EFF' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#webAutoGradient)' />
          <circle cx='22' cy='22' r='11.5' fill='none' stroke='#fff' strokeWidth='2.6' />
          <path
            d='M10.5 22h23M22 10.5c3 3.4 4.5 7.2 4.5 11.5S25 30.1 22 33.5C19 30.1 17.5 26.3 17.5 22S19 13.9 22 10.5Z'
            fill='none'
            stroke='#fff'
            strokeWidth='2.2'
          />
          <path
            d='m30 28 11 4-5.2 2.1L39 40l-3.2 1.7-3.1-6-4 4.1L30 28Z'
            fill='#fff'
            stroke='#2355B6'
            strokeLinejoin='round'
            strokeWidth='1.2'
          />
        </BrandSvg>
      );
    case 'smart_home':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#18BCF2' />
          <path d='m7 24 17-15 17 15v16H7V24Z' fill='#fff' />
          <path
            d='M24 17v15m0-9-6-5m6 9 7-6m-7 11-6 5m6-5 6 5'
            fill='none'
            stroke='#18BCF2'
            strokeLinecap='round'
            strokeWidth='3'
          />
          <circle cx='24' cy='23' r='2.4' fill='#18BCF2' />
        </BrandSvg>
      );
    case 'qclaw':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='qclawGradient' x1='8' y1='7' x2='40' y2='41' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#0FC5CC' />
              <stop offset='1' stopColor='#2563EB' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#qclawGradient)' />
          <path
            d='M35.5 35.5 30 30m5-7.2a11 11 0 1 1-3.2-7.8'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeWidth='4'
          />
          <path
            d='m30 10 2.4 5 4.6-3-1 5.4 5 .8-4.3 3.2 3.2 3.9'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2.7'
          />
        </BrandSvg>
      );
    case 'workbuddy':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='workBuddyGradient' x1='7' y1='7' x2='42' y2='42' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#6757F5' />
              <stop offset='1' stopColor='#18BDF2' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#workBuddyGradient)' />
          <path
            d='m10 13 6.5 22L24 20l7.5 15L38 13'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='4.2'
          />
          <circle cx='10' cy='13' r='2.2' fill='#fff' />
          <circle cx='38' cy='13' r='2.2' fill='#fff' />
        </BrandSvg>
      );
    case 'kiro':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#6D3FF2' />
          <path d='M14 34.5V22.2C14 14.9 18.2 10 24 10s10 4.9 10 12.2v12.3l-5-3.4-5 3.4-5-3.4-5 3.4Z' fill='#fff' />
          <circle cx='20.2' cy='21.5' r='1.8' fill='#6D3FF2' />
          <circle cx='27.8' cy='21.5' r='1.8' fill='#6D3FF2' />
          <path d='M20 26c2.6 1.5 5.4 1.5 8 0' fill='none' stroke='#6D3FF2' strokeLinecap='round' strokeWidth='1.8' />
        </BrandSvg>
      );
    case 'openclaw':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#FFF1F1' />
          <path d='M24 16c6.7 0 12 4.9 12 11s-5.3 11-12 11-12-4.9-12-11 5.3-11 12-11Z' fill='#E23A3A' />
          <path
            d='m15 21-7-5 1 8 5 2m19-5 7-5-1 8-5 2M18 15l-3-5m15 5 3-5M18 29h12M20 34l-2 5m10-5 2 5'
            fill='none'
            stroke='#E23A3A'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='3'
          />
          <circle cx='20' cy='25' r='1.5' fill='#fff' />
          <circle cx='28' cy='25' r='1.5' fill='#fff' />
        </BrandSvg>
      );
    case 'bilibili':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#FB7299' />
          <path
            d='m17 11 5 6m9-6-5 6M10 19h28v20H10V19Z'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='3'
          />
          <circle cx='19' cy='28' r='2' fill='#fff' />
          <circle cx='29' cy='28' r='2' fill='#fff' />
          <path d='M19 34h10' stroke='#fff' strokeLinecap='round' strokeWidth='2.5' />
        </BrandSvg>
      );
    case 'iqiyi':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#00BE06' />
          <rect x='7' y='11' width='34' height='26' rx='5' fill='none' stroke='#fff' strokeWidth='2.5' />
          <text
            x='24'
            y='29'
            fill='#fff'
            fontFamily='Arial, sans-serif'
            fontSize='11'
            fontWeight='700'
            textAnchor='middle'
          >
            iQIYI
          </text>
        </BrandSvg>
      );
    case 'tencent_video':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#F4F8FF' />
          <path
            d='M11 8c-3.6 1.2-5.1 5.2-3 8.2L23.5 39c2 2.9 6.4 2.8 8.2-.3L42 21.3c1.6-2.7.2-6.1-2.8-7L14 7.8c-1-.3-2-.2-3 .2Z'
            fill='#20C876'
          />
          <path d='m15 11 22 7-13 16-9-23Z' fill='#21A5F5' />
          <path d='m21 15 13 4-8 10-5-14Z' fill='#FFD43B' />
          <path d='m24 18 7 2-5 6-2-8Z' fill='#fff' />
        </BrandSvg>
      );
    case 'youku':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#fff' />
          <path d='M8 18h5l4 7 4-7h5l-7 11v7h-4v-7L8 18Z' fill='#00A6FF' />
          <path d='M28 18c8 0 13 3.9 13 9s-5 9-13 9l7-9-7-9Z' fill='#FF2B6A' />
          <path
            d='m28 22 5 5-5 5'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2.5'
          />
        </BrandSvg>
      );
    case 'doubao':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='doubaoGradient' x1='8' y1='8' x2='40' y2='40' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#73A5FF' />
              <stop offset='1' stopColor='#4D55E8' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#doubaoGradient)' />
          <path
            d='M13 25c0-8 5.1-14 12.5-14C33 11 38 16 38 23.5S33.2 37 25 37h-3l-7 4 1.8-7.2A12.8 12.8 0 0 1 13 25Z'
            fill='#fff'
          />
          <path d='M19 22h12M19 28h8' stroke='#5968EA' strokeLinecap='round' strokeWidth='2.8' />
        </BrandSvg>
      );
    case 'visual_studio_code':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#EAF7FF' />
          <path d='m34 7 8 4v26l-8 4-18-17 18-17Z' fill='#23A7F2' />
          <path d='m16 16-8 8 8 8 18-25v34L16 16Z' fill='#0677C8' />
          <path d='m8 24 8-8 5 4-8 8-5-4Z' fill='#1F9CF0' />
        </BrandSvg>
      );
    case 'trae_cn':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#111827' />
          <path d='M10 12h28l-5 7h-7v17h-8V19h-8v-7Z' fill='#8CB4FF' />
          <path d='m26 19 12-7-5 7h-7Z' fill='#B598FF' />
        </BrandSvg>
      );
    case 'qoder':
      return (
        <BrandSvg>
          <defs>
            <linearGradient id='qoderGradient' x1='8' y1='6' x2='41' y2='42' gradientUnits='userSpaceOnUse'>
              <stop stopColor='#8B5CF6' />
              <stop offset='1' stopColor='#2563EB' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill='url(#qoderGradient)' />
          <path
            d='M24 9 38 17v16l-14 8-14-8V17l14-8Z'
            fill='none'
            stroke='#fff'
            strokeLinejoin='round'
            strokeWidth='3'
          />
          <path
            d='M29 30.5 34 35m-4-7.5a6.5 6.5 0 1 1-1.9-4.6'
            fill='none'
            stroke='#fff'
            strokeLinecap='round'
            strokeWidth='3'
          />
        </BrandSvg>
      );
    case 'hermes':
      return (
        <BrandSvg>
          <rect width='48' height='48' rx='12' fill='#FFF7E7' />
          <path
            d='M24 9v30M16 16c-5-4-8-1-7 4 1 4 5 6 11 6m12-10c5-4 8-1 7 4-1 4-5 6-11 6M18 32c4 4 8 4 12 0M19 13l5-5 5 5'
            fill='none'
            stroke='#E2A11A'
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2.8'
          />
        </BrandSvg>
      );
    default:
      return (
        <BrandSvg>
          <defs>
            <linearGradient
              id={`skillFallbackGradient-${skillId}`}
              x1='7'
              y1='7'
              x2='41'
              y2='41'
              gradientUnits='userSpaceOnUse'
            >
              <stop stopColor='#526FFF' />
              <stop offset='1' stopColor='#23B7D9' />
            </linearGradient>
          </defs>
          <rect width='48' height='48' rx='12' fill={`url(#skillFallbackGradient-${skillId})`} />
          <path
            d='M17 12h14v7h5v14h-7v5H15v-5H9V19h8v-7Z'
            fill='none'
            stroke='#fff'
            strokeLinejoin='round'
            strokeWidth='2.8'
          />
          <circle cx='24' cy='26' r='4' fill='#fff' />
        </BrandSvg>
      );
  }
};

const WinkGoSkillBrandIcon: React.FC<WinkGoSkillBrandIconProps> = ({ skillId, displayName }) => {
  const normalizedSkillId = skillId.trim().toLowerCase();
  const imageLogo = imageLogos[normalizedSkillId];

  return (
    <div
      aria-label={`${displayName} logo`}
      className='flex h-40px w-40px shrink-0 items-center justify-center overflow-hidden rounded-10px border border-border-2 bg-white shadow-sm'
      data-testid={`wink-go-skill-logo-${normalizedSkillId}`}
      role='img'
    >
      {imageLogo ? (
        <img
          alt=''
          aria-hidden='true'
          className='h-full w-full object-contain p-6px'
          draggable={false}
          src={imageLogo}
        />
      ) : (
        <VectorBrandIcon skillId={normalizedSkillId} />
      )}
    </div>
  );
};

export default WinkGoSkillBrandIcon;
