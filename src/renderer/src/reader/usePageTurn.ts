import { useEffect, useRef, type RefObject } from 'react'

/**
 * 婵繐绲鹃弸鍐礌閾忚鐣辩紓鍫濐煼閵嗗骞嶇€ｎ亜鈼㈤柨娑欒壘娑斿繘宕ｉ搹顐ゆ嫧闁?+ 闁绘劗鎳撻崵顔句沪韫囨挾顔庣€归潻绠戣ぐ鍛婄▔閵堝嫭娅犻柕?
 *
 * 濞戞捁妗ㄧ划鍫熺▕閸喐鏉归柛锔哄姀缁绘牠鏌屽畝鍐ｅ亾鐏炶偐鐟濋柡鍕靛灠閹洭鎳涢鍡樼暠婵繐绲鹃弸鍐磼閸曨亝顐介梺鎻掔焿缁辩檴PUB 濞?TXT 闁汇劌瀚悙鏇熴亜娴ｅ喚鍤斿☉鏂款槸閻ｎ剟宕楅妸銈囶伇闁?
 * 闁挎稑鐗撻崗姗€寮伴妯峰亾鐏炶偐鐟愬☉鎾亾濡?/ 濞戞挸顑勭粩瀛樸亜閻愬厜鍋撳蹇曠闁挎稑鑻Ο濠囧礆椤愩垹娑ч柛锔哄妽椤掓粓寮崶銊㈠亾鎼存繄鐤勬繛鎾冲级閻撳濡撮崒娑橆杹闁告柨鐏濋惈妯荤鎼存繃鍞夊ù婊勫笒閻即鏁?
 * 濞戞挶鍊楅～鎺楀触鎼达綆浼傞柛蹇氫含閺併倖绋夐埀顒佺閽樺鏉介柣婊冨簻缁辨繈宕楀鍛箒闁衡偓闁稓鍟婂☉鎾亾閺夊牏鎳撶换鏇熺閸℃缍楀☉鎾亾閺夊牆绠嶉埀?
 *
 * **闊洤鎳橀妴蹇涘触鐏炵偓顦х紓浣瑰灣鐞氳京浠﹂崒妯峰亾?* EPUB 闁汇劌瀚婊堝棘閸パ勮含 iframe 闂佹彃鐭夌槐婵嬫偉閼稿灚鐎俊妤嬬导缁楀倿鎯冮崟顓熺＇闁告凹鍓氶弫瑙勭▔瀹ュ懎鐓?
 * iframe 闁告劕鎳橀崕鎾儍?pointer 濞存粌顑勫▎銏ゆ晬濞戞ê娑х紓浣瑰灥椤﹁崵浠﹂崒婊勭暠閻犲洦绻愮槐婵嬫倷閻熺増韬慨婵撶稻閺嬪啯绋夋繝鍐惧殤闁哄啰濮村鑺ユ償閺傜儵鍋?
 * 闁圭鍋撳ù鐘劚椤﹁崵浠﹂崒姘煎晣闁革絻鍔嬬粭?iframe 闁?document 闁告艾瀚划锔界▔閳ь剚绂掗弬銈囩闁稿繗浜弫銈夊触鐏炶偐顏卞┑鍌涱殔閸ㄧ晫鈧鍝庨埀?
 *
 * 濞戞挸顦板顖涚▔瀹ュ牆鍘撮柣顏冭兌濞堟垹鎲撮崟顐㈢仧闁?
 *
 * 1. **婵犲﹥鍨垫慨鈺傚濡搫甯ュù婊冩捣閸嬶綁宕欏Ч鍥ｅ亾?* 闁归潧顑嗙€垫岸骞愭径澶岀憮闁告帞澧楁慨顔炬導閾氬倻顓洪梻鍌涙綑瑜把呮啺娴ｅ顓㈠触閹寸姌鈺呭礉閵娿劎孝閺夆晛娲Σ鍥磹閻撳孩鐨戠紒鐘愁殕缁箓宕濋…鎺旂
 *    闁归鍓濋幑锝夊籍閺堢數鐟濋柛鎰Х琚濋柛娆愬灩閸嬶綁宕欓懡銈囧€冲?闁炽儲鏌￠埀?闁告熬绠戦崹顖涚▔閳ь剙鈻庨埄鍐嫧闁告柣鍔嬬槐鎵礄鐠佸疇鈷堝銈囧仯閳?
 * 2. **缂侀箖娼ч幃婊冾煥閹存繂袟濞戞挸绉堕悾鑽ょ礄婵犳哎鈧濡?* 闁归潧顑嗗┃鈧☉鎾筹攻婢ф粓骞愰崶褏鍙戦梻鍛礃閾斿鎯勭€电娈犻柨娑樻湰閾嗛柛姘灣缂嶅懐绮旂拠鑼畱濡炪倗绮Σ鎴﹀及閹佷海濞存粌娴烽弮閬嶅触閹搭垳绀?
 *    闁告熬绠戦崹顖炴偨閵婏箑鐓曢柟顖氬帠缁楀倹绋夌€ｎ偆娉婂☉鎾亾闁绘劗鎳撳銊ф偖椤愩倗鍊冲銈囧仯閳?
 * 3. **闁哄牆顦甸埀顒€顦亸顖炲籍閺堢數鐟濈紓鍫濐煼閵嗗濡?* 闂傗偓閹稿骸鐦婚梺顐㈩槼閻︽繈濡存担鐟扮彌闁告柣鍔戦埀顒€顦扮€氥劑骞嶇€ｎ偆鍔撮梺顔藉灊缁辩増绂嶈閺?pointer 濞存粌顑勫▎銏ゆ晬?
 *    閺夆晜鐟﹀鍌炲磹濞嗘垹鍊冲銈呭悁缁变即骞庢繝鍕殢闁规挳鏀遍婊堝捶閵娿儱鐏婇柣銊ュ瑜扮偟鈧稒鍔曠槐鏇熺▔椤兘鍋?
 */

/**
 * 婵☆垼浜滈幃婊勬媴瀹ュ泦鈺冩惥閸涙壆绠栭弶鈺傜懁闁叉粓宕撹箛鏇狀槺闁轰胶澧楁晶鐘电不濡や胶鎷ㄩ柛鏂诲妸閳?
 *
 * 40 闁哄嫷鍨剁槐鍫曞冀閸モ晜鐣遍柛姘墦閳ь剙鍊搁埀顒傘€嬬槐婵嬪箥鐎ｎ偄鐦瑰☉鎾崇Х椤㈡垿鏁嶅顓烆杹闁哄牐妗ㄧ粭鍌炲箯閸ャ劌鐦归柛鎺撳笂缁斿瓨绋夌€ｎ剚鐣辨俊顖ｄ簻閹粍鎷呭鍥嗏晝鏁粙璺ㄥ煑闁告瑯浜濆﹢浣圭鐏炶偐鐟忛柛妞剧閸庢氨妲愰悪鍛
 * 閻忓繈鍊曢崣楣冨及椤栨瑧顏遍弶鍫㈩攰閾斿鎹勯娆戭伇閺夊牆婀卞﹢鍛存儍閸曨剚顦ч柛濠冪懀閳?4 闁哄嫷鍨埀顒€鐬奸崑锝咁潰椤忓啰鍟婇柕鍡楃С缁楀矂濡寸仦鎯у帓闁告帗甯婄粩瀛樼▔鐎ｃ劉鍋撳鍕吅闂傚倸顕▓鎴﹀礆閸℃瑦娅?闁炽儲鏌￠埀?
 * 闁绘劗鎳撻崵顕€鎯冮崟顐晣鐎瑰壊鍠栬ぐ鐔煎嫉?TAP_SLOP 缂佺媴绱曞鍐晬鐏炶壈鈷堥柤鏉挎噸缁楀宕橀懠顒傚磹闁?
 */
const SWIPE_MIN_DISTANCE = 24

/**
 * 婵犲﹥鍨垫慨鈺呭籍閼稿緱顓㈠触閹存粎绉寸紒澶嬫閸わ妇浜搁幋锝庢矗闁哄嫷鍨抽弮閬嶅触閹寸姵鐣遍弶鈺傜懁缁犵偞寰勫顑藉亾瀹ュ繒绀夐梺顒€鐏濋崢銈夊棘濠婂懏绲婚柛鎺撳笂缁斿瓨绋夌€ｎ亝鐨戦悶姘煎亞閻愭洘銇勯悙鍏夊亾?
 *
 * 1.5 閻庝絻顫夋晶婊堝箰閸パ佷喊濞戞挶鍎荤槐浼村箥鐎ｎ偄鐦圭€垫澘鐗撳В锔炬導閹殿喗绾紒鎯у皡缁辨繈寮鍛祷闁告帗甯婄粩瀛樼▔鐎ｎ剚鐣辨俊顖ｄ簽閺冨崬袙閺傝法鍩楅柛?1.2 濞戞挸锕ｇ粭鍛存晬?
 * 濞存粌瀛╁Σ鎼佸Υ鐏炴儳鍘掔紓鍫濐煼閵嗗濡村鍫蕉鐟滅増鎸婚崹姘跺Υ鐏炴儳鍘掓繝濠冭壘婵晠濡村蹇曠濞寸姭鍋撳☉鏂跨墦閸忔ɑ绋夊鍛岛闁汇垻鍠嗛埀?.2 濞寸姴绉堕崝褔鎳楅懞銉ョ殹濞?
 * 闁哄嫬瀛╁Ο澶愭儍閸曨厽妫婚柛姘灦缁挳宕濋…鎺旂闂侇叏绲块～鎺懳熼鍡樻；婵絾妫冮埀顒佽壘閻栧墎浜歌箛搴ｈ壘 0.5闁挎稑顦埀?
 */
const SWIPE_AXIS_RATIO = 1.2

/** 濞戞挴鍋撴繛鍡忓墲缁箓宕濋妸锔戒粯濠㈣埖姘ㄩ悙鏇熺▔閳ь剚銇勭喊澶岀獥閻℃帒鎳撶换鍐╂交濞嗗酣鍤嬮柡鍐ㄧ埣濡寧寰勫顒€纾归柡鍕靛灛閳ь剙鏈€垫粍鎷呰箛搴ｇ憹闁告柣鍔婇埀顒€绋勭槐婵囩▔瀹ュ棙笑婵犲﹥鍨垫慨鈺呭Υ?*/
const SWIPE_MAX_DURATION = 800

/**
 * 闁绘劗鎳撻崵顕€鎷冮挊澶嬭含鐎归潻绠戣ぐ鍛婃交濞嗗酣鍤嬫慨锝嗘煣缁躲儵鎯冮崟顐㈤殬闁糕晝鍠庨崬鎾箥瀹ュ洨鏆紓鍫濐煼閵嗗鏁嶇仦鑹板幀闂傚倸顕弳鈧紓浣圭懀閳ь剙鑻弫婊堝礄閸濆嫪绱ｉ柛蹇涙敱閻栴噣濡村鍐ｅ亾?
 *
 * 0.3 闁规澘绻愰幊妤呮儓閳ь剚绋夐銏★紵 40% 闁哄嫷鍨遍鎾礌閹巻鍋撻崒娑橆杹闁哄牐妗ㄧ粭鍌氼潰閿濆棙鐎柛娆樹簼濠€浣圭▔婢跺﹥纾介柣褎鍎抽崕姘辨閻樺樊鍟嶉柨娑樻湰椤掓挳宕犻崫鍕殤闁哄嫷鍨粩鎾儌閹屾▼闁稿秴绻掔粈宀勬晬?
 * 闁活潿鍔嶉崺娑㈡倷閻熺増鎲块柛搴℃健閸忔ɑ绋夊鍥╁€冲銈囶暜缁辨繈鎯囩€ｎ厽宕抽柡澶堝劚閸庢岸濡村畝鈧悙鏇熴亜闂堟稒缍庡ù婊冩閳ь剙绉查埀?.4 闁硅泛锕ラ鎾礌閸濆嫬绔鹃柛?20%闁?
 * 濞寸姴绉堕崝褔鎮惧▎蹇曠箒濞戞挸顑呴弫婊堝礄閸濆嫪绱ｉ柛蹇涙敱閻栴噣鎯冮崟顏嗙Т缂傚喚鍣槐婵囨媴閸℃ぞ绠柛娆忓暱閹?40% 闂侇喖鈧喎鍘寸紓鍫濐煼閵嗗濡?
 */
const TAP_ZONE_RATIO = 0.4

/** 濞达絽绉朵簺閻℃帒鎳撶换鍐╂交濞嗗酣鍤嬮柛宥呯箳缁€宀勫极閺夋寧鐨戝☉鎾崇Т缂嶅鎮欓悷鏉挎瘖濠㈣泛瀚幃濠囨晬閸喐鐏橀柣顐熷亾闁告帗甯婄花鈩冪▔閳ь剚绋夌€ｅ墎绀夐柡鍐炬線缁楀寮伴娑氭嫧闁告柣鍔嬬弧鍐╃▔瀹ュ棙笑闁绘劗鎳撻崵顕€鏁嶆径鍫氬亾?*/
const TAP_SLOP = 10

/**
 * 闁归潧顑呮繛宥囨啺娴ｈ鏉归悶娑樼灱濞堟垿宕楅崘顏嗩槺闁挎稒淇洪幆銈夊捶閵娿劎绠瑰ù婊勭☉閸樻挾妲愰悩杈╃憪闁汇劌瀚€垫粍绋夌€ｂ晝鐟濋柛娆忓€风粭宀€绱欐繝姘モ偓澶愬Υ?
 *
 * 闁烩晜鍨甸幆澶岀磼閹存繃韬柡浣虹節闁?document 濞戞挸顭槐婵嬪箥閳ь剚绂掗妷褍浠銈堝煐閻栴噣骞愭径鎰唉闁靛棔鑳堕崑锝夊箮閽樺婧勯梺鎻掔灱濞堟垿鎯勯鑲╃Э濡炪倕绠嶉埀顑胯兌閸嬶綁鏌呮径濠傞殬婵炴惌鍠楀?
 * 闂侇喗鍨濈槐鎵導閺夊灝鐓傞弶鈺傜懇閸ｇ兘濡撮崒娆戠憹闁圭儤甯″▍搴ㄦ儍閸曨喚妯堥柨娑樼灱閸嬶綁濡寸仦鑲╃憮濞戞挴鍋撳銈囧仯閳ь剙绉电€垫粓鏌﹂鑽ょ獥闁稿繐鐗忛悙鏇熴亜閻愬厜鍋撴担绋挎櫃閻炴凹鍋勭紞瀣箣閹邦喖浠柛鎴ｎ唺閼垫垿姊婚弶鎴濋殬
 * 闁硅泛锕妴濠囧冀韫囨梹鏆悹褔鏀卞?闁炽儲鏌￠埀?闁圭顦甸幐鎶芥儑鐎ｎ剚绲婚柛宥呯箰閵囨垿鎮橀崗鍝ュ晩闁?
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '.reader__header',
  '.reader__controls',
  '.reader__drawer',
  '.reader__selection-toolbar'
].join(',')

/** 濞存粌顑勫▎銏ゆ儎椤旂晫鍨奸柡鍕靛灠閹線鎷冮挊澶嬭含濞存嚎鍊撶花浼村礂閸愵亞顦遍梺鎻掔焿缁辨瑩宕?iframe 闁告劕鎳橀崕鎾晬婢跺牃鍋?*/
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}

export interface UsePageTurnOptions {
  /** 闁归潧顑呮繛宥夊箰閸屾繃绁伴柣銊ュ椤﹁崵浠﹂崒姘煎晣闁革絻鍔婇埀?*/
  targetRef: RefObject<HTMLElement | null>
  /**
   * 婵繐绲鹃弸鍐礆濡ゅ绀刞.reader__viewport`闁挎稑顦埀顒€鍊婚崑锝夊礄鐠囨彃鐎婚柛鏍劋鐎垫粎鈧懓鍟板▓鎴犫偓纭呮鐎瑰磭绮诲Δ瀣濞戞挸绉电€垫粍寰勯弽褏婀撮悗鍦嚀濞呮帞绮诲灏栧亾?
   *
   * 濠㈣埖鐗曢惇鎵偓鍦嚀濞呮帡寮伴娑欐缂佹劖顨呴鏃堟晬鐏炵虎鍔€闁哄倸娲ら崹顏堝及椤栨氨婀峰☉鎿冨幒缁楁牠寮寸€靛摜宕曢柣銊ュ缁旀挳寮堕埥鍛耿闁圭顦ˇ鑽や沪閸屾粎鏆ù鍏间亢椤斺偓婵繐绲鹃弸鍐礆濡炴崘鍘梻?
   * 濞戞挴鍋撳鍫嗗懎顣婚柦鈧崐鐔虹婵繆顕х亸顖炴晬瀹€鈧弫銈夊箣妞嬪骸浠慨婵撶稻閺嬪啯绋夊鍥╁€冲銈囧仯閳ь剙鍊风粭澶嬪閻樿櫕顦ч梺顐熷亾闁搞儳鍋熼弫銈嗗緞閺嵮呮勾閻庡湱鎳撳▍鎺楀Υ?
   */
  viewportRef?: RefObject<HTMLElement | null>
  /**
   * EPUB 婵繐绲鹃弸鍐箥閳ь剟宕烽妸褎鐣?iframe document闁?
   *
   * 濞?null 閻炴稏鍔庨妵姘潰閿濆棙鐎☉鎾崇Т濠€?iframe 闂佹彃鐭夌槐姗砐T 閻忓繗椴稿Σ鍛婃交濞嗘埈娼氶柨娑橆檧缁辨繈宕ｉ鍡欐嫧濠㈣埖鐗曢惇浼村Υ?
   * 婵絽绻戦鑲╃礄婵犳哎鈧?epub.js 濞村吋纰嶅畷鏌ュ箳?iframe闁挎稑鏈晶宥嗙閵夈劎绠瑰☉鎿冧簻閳ь剛鍘цぐ澶愬礌閺嶃劍顦ч悷鏇氱窔閸ｆ悂寮幍顔炬嫧閻庤鍝庨埀?
   */
  innerDocument?: Document | null
  /** 缂傚牆顭烽妴澶愬炊閻愬墎娈堕柨娑欑◥缁楀本鎯旈弴銏犲姤闁圭顦甸幐宕囨導閹殿喗鐣遍柡鍕靛灠閹挻绋夐埀顒佺▔?move闁?*/
  onMove: (direction: 'next' | 'prev') => void
  /** 闁绘劗鎳撻崵顔句沪韫囨挾顔庡☉鎿冨弮濡潡寮幆闈舵洟宕ｉ幋顖滅闁活潿鍔嶅鐢稿船閵堝懎姣?/ 闁衡偓閹増宕崇€规悶鍎遍崣鍧楀冀韫囧鍋?*/
  onToggleChrome: () => void
  /** 濞?true 闁哄啳鍩栭弳锝嗙▔椤忓懎顤侀柛鏂跨仢閻即宕戝鍛殢闁挎稑鐗呯欢銉︿繆閸屾繄绠锋繛灞糕偓鍐差潱閺夌偠妫勯悾顒勬晬婢跺牃鍋?*/
  disabled?: boolean
}

/**
 * 闁硅泛锕﹂悙鏇熴亜閸偄顤侀柛鏃囨硶缁箓宕氶弶娆惧晣闁革絻鍔嬬粭鍌炲Υ?
 *
 * 闁?pointer 濞存粌顑勫▎銏ゆ嚀鐏炶偐鐟濋柡?touch闁挎稒顒猳inter 闁告艾鏈鍌滄啺閸℃瑦纾伴悷娆欓檮閹虫粓濡存笟鈧槐鍫曞冀閸ワ妇鐟㈤悷娆欓檮鐢墎绮弮鎾剁
 * 婵℃鐭傚鎵博椤栨瑧鐦嶉柤宕囨櫕閺併倖螚閻樺磭鍨奸柟閿嬬墬鐎氳法绱欐繝姘モ偓澶愭晬鐏炶偐鐟濋煫鍥ф噹閸熸挻绋夐妶鍜佹闁?
 */
export function usePageTurn({
  targetRef,
  viewportRef,
  innerDocument = null,
  onMove,
  onToggleChrome,
  disabled = false
}: UsePageTurnOptions): void {
  // 闁?ref 閻庢稒锚濞叉牜鎷崘璺ㄧ闂侇剙鐏濋崢銈呅掕箛鏃戝仹婵炴挸寮堕悡瀣焾娴犲娅㈤柡鍌涘缁妇鈧姘ㄥú鍐触?
  const onMoveRef = useRef(onMove)
  const onToggleChromeRef = useRef(onToggleChrome)
  onMoveRef.current = onMove
  onToggleChromeRef.current = onToggleChrome

  useEffect(() => {
    const target = targetRef.current
    if (!target || disabled) return
    // 闁衡偓閸撲胶宕曢柟瀛樺姍濞碱亞绮氶崫鍕煑闂佹彃楠忕槐婵嬫⒒椤撶偛鐦堕梺鎻掓湰婢х娀骞忛崹顔剧箒闁告帊鍗冲顏嗙矚閾忕顫﹂柛?
    const container: HTMLElement = target
    // 婵絽绻戦濂稿箥鐎ｎ亜鈼㈤梺顔荤矙閸ｆ悂寮幏宀婂殺濞戞挴鍋撴繛鍡忔缁辨壆绮ｅΔ鈧ぐ娑氫焊閸濆嫷鍤熼柛娆惷€垫煡寮懜娈垮妧闁哄倸娲ら崹顏嗏偓纭呮鐎硅櫕瀵煎顒€缍?
    const viewport = viewportRef?.current ?? null

    // 濞戞挴鍋撴繛鍡忓墲婢ф粓宕濋崹顔兼锭濠㈣泛瀚幃濠冪▔閳ь剙鈻庨埥鍛獥婵犲﹥鍨垫慨鈺冪礄婵犳哎鈧绋婄€ｎ亝鍊甸柨娑樻湰婵喚鎸ч摎鍌滅殤濞寸姵婀圭粭澶愭嚄閽樺鏅欑憸鐗堟尰閸ㄦ岸鎮欓悷鏉挎瘖
    let start: { x: number; y: number; time: number } | null = null
    let consumed = false

    function handlePointerDown(event: PointerEvent): void {
      // 闁告瑯浜ｉ缁樼▔婵犳碍鏆?/ 闁告娲樼€垫岸鏁嶅☉姗嗘▼闁圭娴勭槐娆戠磽閳哄倹鏉归柨娑橆槷缁楀宕ｉ崒娆戠憿缂傚牆顭烽妴?
      if (event.button !== 0) return
      // 闁绘劗鎳撳﹢顏堝箰婢舵劖灏﹂柕鍡曠窔閹藉ジ骞掗妷锝傚亾娴ｇ懓鈻曢悘鐐差槷缁楀倿寮張鐢电憹闁规亽鍎抽鎼佹晬濮樿泛浜濋柡?UI 闁煎浜滅换渚€鎯冮崟顓炰化闁?
      if (isInteractive(event.target)) return
      start = { x: event.clientX, y: event.clientY, time: Date.now() }
      consumed = false
    }

    function handlePointerUp(event: PointerEvent): void {
      const origin = start
      start = null
      if (!origin || consumed) return

      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      const elapsed = Date.now() - origin.time

      // 闁哄牆顦甸埀顒€顦亸顖炲籍閺堢數鐟濈紓鍫濐煼閵嗗鏁嶅杈ㄦ殢闁规挳鏀遍婊堝捶閵娾斁鍋撴径搴ｆГ闁挎稑鐬奸悙鏇熴亜閸忓摜绐楅柟璺猴躬閳ь剙顦亸顖氼嚕閸曨亝涓?
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return

      const isSwipe =
        Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
        Math.abs(dx) >= Math.abs(dy) * SWIPE_AXIS_RATIO &&
        elapsed <= SWIPE_MAX_DURATION

      if (isSwipe) {
        consumed = true
        // 闁告碍鍨垫稊蹇涘礆閹虹偟绀刣x < 0闁挎稑顦卞﹢鍛▔鐎ｂ晝顏卞銈囶暜缁辨繃绋夋惔锝囧墾閻犳劑鍔嬮崝鐔虹礄婵犳哎鈧寮悷鐗堝€诲☉鎾亾闁?
        onMoveRef.current(dx < 0 ? 'next' : 'prev')
        return
      }

      // 濞达絽绉朵簺濠㈤浜滈妵鍥ㄦ媴閸℃洜鐟濋柡鍕靛灡缁箓宕濋…鎺旂婵絾鏌ㄩ々褔寮鍛祷闁告帗甯槐姘舵晬鐏炶偐鐟濈憸鐗堟尵閸嬶綁宕欑拠宸П闁?
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) return

      // 闁告帒妫楃亸顖滄啺娴ｇ懓鐦婚柕鍡楃灱閺併倝骞嬫搴㈢畽鐎电増顨夐～鍡涙儍閸曨剦鍔€闁哄倸娲ら崹顏堝Υ瀹ュ洨鏆柨娑樺缁楀鎳楅懞銉ョ樆濠㈣埖鐗曢惇鎵偓鍦嚀濞呮帞绮诲灏栧亾?
      //
      // 濠㈣埖鐗曢惇?.reader__body 闁哄嫷鍨遍弳锝囩玻濡も偓椤旀棃鏁嶉崼鐕佹斀闂?1087px闁挎稑顧€缁辨繂顫㈤敐鍡樼€柛?.reader__viewport
      // 闁?min(900px, 100%) 閻忕偛鎳嶉懙鎴︽晬閸噥鏀介梻?900px闁挎稑鑻稊蹇旀綇绾懐绠风紒灞芥惈閸?93px闁挎稑顦埀?
      // 闁圭顦ˇ鑽や沪閸屾粎鏆柣銊ュ閻︿粙鏁嶅畝鈧弫銈夊箣妞嬪骸浠柛锔哄妽椤掓粓寮崶褍鐏?15% 濠㈣泛瀚哥槐婵堢不濡も偓閸ゎ參寮堕妷锔叫?0.19闁挎稑鐭侀幆銈嗘交濞戞瑯鍔ラ柛?闁炽儲鏌￠埀?
      // 婵繐绲鹃弸鍐礆濡炴崘鍘梻?70% 闁稿繈鍔戦崗妯荤▔瀹ュ洨鍊冲銈囶暜缁辨繈鎯囩€ｎ厽宕抽柡澶堝劚濮樸劑寮伴妯峰亾瀹€鈧悙鏇熴亜闂堟稒缍庡ù婊冩閳ь剙绉查埀?
      //
      // iframe 闂佹彃鐬煎▓?clientX 闁哄嫷鍨甸～瀣矗閿濆懏缍忛柡宥呮祫缁辨繃绋夋惔鈽嗘▎閻忕偛鍊诲▓?getBoundingClientRect 闁告艾濂旂粩鎾锤閹邦厾鍨肩紒顖欑串缁?
      // 闁圭鍋撳ù鐘劥缁绘牠鏌岀仦钘夎濞寸姰鍎冲ú鍧楀箳閵壯勬殢婵繐绲鹃弸鍐礆濡ゅ啯鐣?rect 闁告绮惁顕€濡?
      const rect = (viewport ?? container).getBoundingClientRect()
      if (rect.width === 0) return
      const ratio = (event.clientX - rect.left) / rect.width

      consumed = true
      if (ratio <= TAP_ZONE_RATIO) {
        onMoveRef.current('prev')
      } else if (ratio >= 1 - TAP_ZONE_RATIO) {
        onMoveRef.current('next')
      } else {
        onToggleChromeRef.current()
      }
    }

    function handlePointerCancel(): void {
      start = null
      consumed = false
    }

    const bound: Document[] = [document]
    if (innerDocument && innerDocument !== document) bound.push(innerDocument)

    for (const doc of bound) {
      doc.addEventListener('pointerdown', handlePointerDown)
      doc.addEventListener('pointerup', handlePointerUp)
      doc.addEventListener('pointercancel', handlePointerCancel)
    }

    return () => {
      for (const doc of bound) {
        doc.removeEventListener('pointerdown', handlePointerDown)
        doc.removeEventListener('pointerup', handlePointerUp)
        doc.removeEventListener('pointercancel', handlePointerCancel)
      }
    }
  }, [targetRef, innerDocument, disabled])
}
