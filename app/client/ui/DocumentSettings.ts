/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {cssSmallButton, cssSmallLinkButton} from 'app/client/components/Forms/styles';
import {GristDoc} from 'app/client/components/GristDoc';
import {ACIndexImpl} from 'app/client/lib/ACIndex';
import {ACSelectItem, buildACSelect} from 'app/client/lib/ACSelect';
import {copyToClipboard} from 'app/client/lib/clipboardUtils';
import {makeT} from 'app/client/lib/localization';
import {reportError} from 'app/client/models/AppModel';
import type {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {AdminSection, AdminSectionItem} from 'app/client/ui/AdminPanelCss';
import {hoverTooltip, showTransientTooltip} from 'app/client/ui/tooltips';
import {colors, mediaSmall, testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {select} from 'app/client/ui2018/menus';
import {confirmModal} from 'app/client/ui2018/modals';
import {buildCurrencyPicker} from 'app/client/widgets/CurrencyPicker';
import {buildTZAutocomplete} from 'app/client/widgets/TZAutocomplete';
import {EngineCode} from 'app/common/DocumentSettings';
import {commonUrls, GristLoadConfig} from 'app/common/gristUrls';
import {propertyCompare} from 'app/common/gutil';
import {getCurrency, locales} from 'app/common/Locales';
import {Computed, Disposable, dom, fromKo, IDisposableOwner, styled} from 'grainjs';
import * as moment from 'moment-timezone';

const t = makeT('DocumentSettings');

export class DocSettingsPage extends Disposable {
  private _docInfo = this._gristDoc.docInfo;

  private _timezone = this._docInfo.timezone;
  private _locale: KoSaveableObservable<string> = this._docInfo.documentSettingsJson.prop('locale');
  private _currency: KoSaveableObservable<string|undefined> = this._docInfo.documentSettingsJson.prop('currency');
  private _engine: Computed<EngineCode|undefined> = Computed.create(this, (
    use => use(this._docInfo.documentSettingsJson.prop('engine'))
  ))
    .onWrite(val => this._setEngine(val));

  private _engines = getSupportedEngineChoices().map((engine) => ({
    value: engine,
    label: engine === 'python3' ? t(`python3 (recommended)`) : t(`python2 (legacy)`),
  }));

  constructor(private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    const canChangeEngine = getSupportedEngineChoices().length > 0;
    const docPageModel = this._gristDoc.docPageModel;

    return cssContainer(
      dom.create(AdminSection, t('Document Settings'), [
        dom.create(AdminSectionItem, {
          id: 'timezone',
          name: t('Time Zone'),
          description: t('Default for DateTime columns'),
          value: dom.create(cssTZAutoComplete, moment, fromKo(this._timezone), (val) => this._timezone.saveOnly(val)),
        }),
        dom.create(AdminSectionItem, {
          id: 'locale',
          name: t('Locale'),
          description: t('For number and date formats'),
          value: dom.create(cssLocalePicker, this._locale),
        }),
        dom.create(AdminSectionItem, {
          id: 'currency',
          name: t('Currency'),
          description: t('For currency columns'),
          value: dom.domComputed(fromKo(this._locale), (l) =>
            dom.create(cssCurrencyPicker, fromKo(this._currency), (val) => this._currency.saveOnly(val),
              {defaultCurrencyLabel: t("Local currency ({{currency}})", {currency: getCurrency(l)})})
          )
        }),
      ]),

      dom.create(AdminSection, t('Data Engine'), [
        // dom.create(AdminSectionItem, {
        //   id: 'timings',
        //   name: t('Formula times'),
        //   description: t('Find slow formulas'),
        //   value: dom('div', t('Coming soon')),
        //   expandedContent: dom('div', t(
        //     'Once you start timing, Grist will measure the time it takes to evaluate each formula. ' +
        //     'This allows diagnosing which formulas are responsible for slow performance when a ' +
        //     'document is first open, or when a document responds to changes.'
        //   )),
        // }),

        dom.create(AdminSectionItem, {
          id: 'reload',
          name: t('Reload'),
          description: t('Hard reset of data engine'),
          value: cssSmallButton('Reload data engine', dom.on('click', async () => {
            await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
            document.location.reload();
          }))
        }),

        canChangeEngine ? dom.create(AdminSectionItem, {
          id: 'python',
          name: t('Python'),
          description: t('Python version used'),
          value: cssSelect(this._engine, this._engines),
        }) : null,
      ]),

      dom.create(AdminSection, t('API'), [
        dom.create(AdminSectionItem, {
          id: 'documentId',
          name: t('Document ID'),
          description: t('ID for API use'),
          value: cssHoverWrapper(
            cssInput(docPageModel.currentDocId.get(), {tabIndex: "-1"}, clickToSelect(), readonly()),
            cssCopyButton(
              cssIcon('Copy'),
              hoverTooltip(t('Copy to clipboard'), {
                key: TOOLTIP_KEY,
              }),
              copyHandler(() => docPageModel.currentDocId.get()!, t("Document ID copied to clipboard")),
            ),
          ),
          expandedContent: dom('div',
            cssWrap(
              t('Document ID to use whenever the REST API calls for {{docId}}. See {{apiURL}}', {
                apiURL: cssLink({href: commonUrls.helpAPI, target: '_blank'}, t('API documentation.')),
                docId: dom('code', 'docId')
              })
            ),
            dom.domComputed(urlState().makeUrl({
              api: true,
              docPage: undefined,
              doc: docPageModel.currentDocId.get(),
            }), url => [
              cssWrap(t('Base doc URL: {{docApiUrl}}', {
                docApiUrl: cssCopyLink(
                  {href: url},
                  url,
                  copyHandler(() => url, t("API URL copied to clipboard")),
                  hoverTooltip(t('Copy to clipboard'), {
                    key: TOOLTIP_KEY,
                  }),
                )
              })),
            ]),
          ),
        }),
        dom.create(AdminSectionItem, {
          id: 'api-console',
          name: t('API Console'),
          description: t('Try API calls from the browser'),
          value: cssSmallLinkButton(t('API console'), {
            target: '_blank',
            href: getApiConsoleLink(docPageModel),
          }),
        }),

        dom.create(AdminSectionItem, {
          id: 'webhooks',
          name: t('Webhooks'),
          description: t('Notify other services on doc changes'),
          value: cssSmallLinkButton(t('Manage webhooks'), urlState().setLinkUrl({docPage: 'webhook'})),
        }),
      ]),
    );
  }

  private async _setEngine(val: EngineCode|undefined) {
    confirmModal(t('Save and Reload'), t('Ok'), () => this._doSetEngine(val));
  }

  private async _doSetEngine(val: EngineCode|undefined) {
    const docPageModel = this._gristDoc.docPageModel;
    if (this._engine.get() !== val) {
      await this._docInfo.documentSettingsJson.prop('engine').saveOnly(val);
      await docPageModel.appModel.api.getDocAPI(docPageModel.currentDocId.get()!).forceReload();
    }
  }
}

function getApiConsoleLink(docPageModel: DocPageModel) {
  const url = new URL(location.href);
  url.pathname = '/apiconsole';
  url.searchParams.set('docId', docPageModel.currentDocId.get()!);
  // Some extra question marks to placate a test fixture at test/fixtures/projects/DocumentSettings.ts
  url.searchParams.set('workspaceId', String(docPageModel.currentWorkspace?.get()?.id || ''));
  url.searchParams.set('orgId', String(docPageModel.appModel?.topAppModel.currentSubdomain.get()));
  return url.href;
}

type LocaleItem = ACSelectItem & {locale?: string};

function buildLocaleSelect(
  owner: IDisposableOwner,
  locale: KoSaveableObservable<string>,
) {
  const localeList: LocaleItem[] = locales.map(l => ({
    value: l.name, // Use name as a value, we will translate the name into the locale on save
    label: l.name,
    locale: l.code,
    cleanText: l.name.trim().toLowerCase(),
  })).sort(propertyCompare("label"));
  const acIndex = new ACIndexImpl<LocaleItem>(localeList, {maxResults: 200, keepOrder: true});
  // AC select will show the value (in this case locale) not a label when something is selected.
  // To show the label - create another observable that will be in sync with the value, but
  // will contain text.
  const textObs = Computed.create(owner, use => {
    const localeCode = use(locale);
    const localeName = locales.find(l => l.code === localeCode)?.name || localeCode;
    return localeName;
  });
  return buildACSelect(owner,
    {
      acIndex, valueObs: textObs,
      save(_value, item: LocaleItem | undefined) {
        if (!item) { throw new Error("Invalid locale"); }
        locale.saveOnly(item.locale!).catch(reportError);
      },
    },
    testId("locale-autocomplete")
  );
}

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);

const cssCopyButton = styled('div', `
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 24px;
  right: 0;
  top: 0;
  --icon-color: ${theme.lightText};
  &:hover {
    --icon-color: ${colors.lightGreen};
  }
`);

const cssIcon = styled(icon, `
`);

const cssInput = styled('div', `
  border: none;
  outline: none;
  background: transparent;
  width: 100%;
  min-width: 180px;
  height: 100%;
  padding: 5px;
  padding-right: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssHoverWrapper = styled('div', `
  max-width: 280px;
  text-overflow: ellipsis;
  overflow: hidden;
  text-wrap: nowrap;
  display: inline-block;
  cursor: pointer;
  transition: all 0.05s;
  border-radius: 4px;
  border-color: ${theme.inputBorder};
  border-style: solid;
  border-width: 1px;
  height: 30px;
  align-items: center;
  position: relative;
`);

// This matches the style used in showProfileModal in app/client/ui/AccountWidget.


// Check which engines can be selected in the UI, if any.
export function getSupportedEngineChoices(): EngineCode[] {
  const gristConfig: GristLoadConfig = (window as any).gristConfig || {};
  return gristConfig.supportEngines || [];
}

const cssSelect = styled(select, `
  min-width: 170px; /* to match the width of the timezone picker */
`);

const TOOLTIP_KEY = 'copy-on-settings';


function copyHandler(value: () => string, confirmation: string) {
  return dom.on('click', async (e, d) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    showTransientTooltip(d as Element, confirmation, {
      key: TOOLTIP_KEY
    });
    await copyToClipboard(value());
  });
}

function readonly() {
  return [
    { contentEditable: 'false', spellcheck: 'false' },
  ];
}

function clickToSelect() {
  return dom.on('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const range = document.createRange();
    range.selectNodeContents(e.target as Node);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}

// A version that is not underlined, and on hover mouse pointer indicates that copy is available
const cssCopyLink = styled(cssLink, `
  word-wrap: break-word;
  &:hover {
    border-radius: 4px;
    text-decoration: none;
    background: ${theme.lightHover};
    outline-color: ${theme.linkHover};
    outline-offset: 1px;
  }
`);

const cssAutoComplete = `
  width: 172px;
  cursor: pointer;
  & input {
    text-overflow: ellipsis;
    padding-right: 24px;
  }
`;

const cssTZAutoComplete = styled(buildTZAutocomplete, cssAutoComplete);
const cssCurrencyPicker = styled(buildCurrencyPicker, cssAutoComplete);
const cssLocalePicker = styled(buildLocaleSelect, cssAutoComplete);

const cssWrap = styled('p', `
  overflow-wrap: anywhere;
  & * {
    word-break: break-all;
  }
`);
