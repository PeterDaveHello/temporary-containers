const { debug } = require('./log');

class Container {
  constructor(background) {
    this.storage = background.storage;
    this.automaticModeState = background.automaticModeState;

    this.containerColors = [
      'blue',
      'turquoise',
      'green',
      'yellow',
      'orange',
      'red',
      'pink',
      'purple',
    ];

    this.containerIcons = [
      'fingerprint',
      'briefcase',
      'dollar',
      'cart',
      'circle',
      'gift',
      'vacation',
      'food',
      'fruit',
      'pet',
      'tree',
      'chill',
    ];
  }


  async createTabInTempContainer(tab, url) {
    let tempContainerNumber;
    if (this.storage.local.preferences.containerNumberMode === 'keep') {
      this.storage.local.tempContainerCounter++;
      tempContainerNumber = this.storage.local.tempContainerCounter;
    }
    if (this.storage.local.preferences.containerNumberMode === 'reuse') {
      const tempContainersNumbers = Object.values(this.storage.local.tempContainers).sort();
      debug('[createTabInTempContainer] tempContainersNumbers', tempContainersNumbers);
      if (!tempContainersNumbers.length) {
        tempContainerNumber = 1;
      } else {
        const maxContainerNumber = Math.max.apply(Math, tempContainersNumbers);
        debug('[createTabInTempContainer] maxContainerNumber', maxContainerNumber, tempContainersNumbers);
        for (let i = 1; i < maxContainerNumber; i++) {
          debug('[createTabInTempContainer] tempContainersNumbers[i]', i, tempContainersNumbers[i]);
          if (!tempContainersNumbers.includes(i)) {
            tempContainerNumber = i;
            break;
          }
        }
        if (!tempContainerNumber) {
          tempContainerNumber = maxContainerNumber + 1;
        }
      }
    }
    const containerName = `${this.storage.local.preferences.containerNamePrefix}${tempContainerNumber}`;
    try {
      let containerColor = this.storage.local.preferences.containerColor;
      if (this.storage.local.preferences.containerColorRandom) {
        containerColor = this.containerColors[Math.floor(Math.random() * this.containerColors.length)];
      }
      let containerIcon = this.storage.local.preferences.containerIcon;
      if (this.storage.local.preferences.containerIconRandom) {
        containerIcon = this.containerIcons[Math.floor(Math.random() * this.containerIcons.length)];
      }
      const contextualIdentity = await browser.contextualIdentities.create({
        name: containerName,
        color: containerColor,
        icon: containerIcon
      });
      debug('[createTabInTempContainer] contextualIdentity created', contextualIdentity);
      this.storage.local.tempContainers[contextualIdentity.cookieStoreId] = tempContainerNumber;
      await this.storage.persist();

      try {
        const active = url ? false : true;
        const newTabOptions = {
          url,
          active,
          cookieStoreId: contextualIdentity.cookieStoreId,
        };
        if (tab && tab.index) {
          newTabOptions.index = tab.index + 1;
        }

        debug('[createTabInTempContainer] creating tab in temporary container', newTabOptions);
        const newTab = await browser.tabs.create(newTabOptions);
        debug('[createTabInTempContainer] new tab in temp container created', newTab);
        this.storage.local.tabContainerMap[newTab.id] = contextualIdentity.cookieStoreId;
        await this.storage.persist();

        return newTab;
      } catch (error) {
        debug('[createTabInTempContainer] error while creating new tab', error);
      }
    } catch (error) {
      debug('[createTabInTempContainer] error while creating container', containerName, error);
    }
  }


  async reloadTabInTempContainer(tab, url) {
    const newTab = await this.createTabInTempContainer(tab, url);
    if (!tab) {
      return newTab;
    }
    try {
      await browser.tabs.remove(tab.id);
      debug('[reloadTabInTempContainer] removed old tab', tab.id);
    } catch (error) {
      debug('[reloadTabInTempContainer] error while removing old tab', tab, error);
    }
    return newTab;
  }


  async maybeReloadTabInTempContainer(tab) {
    if (!this.storage.local.preferences.automaticMode) {
      debug('[maybeReloadTabInTempContainer] automatic mode not active, we ignore that', tab);
      return;
    }

    if (tab.incognito) {
      debug('[maybeReloadTabInTempContainer] tab is incognito, ignore it', tab);
      return;
    }

    if (tab.cookieStoreId === 'firefox-default' &&
       (tab.url === 'about:home' ||
        tab.url === 'about:newtab')) {
      debug('[maybeReloadTabInTempContainer] about:home/new tab in firefox-default container, reload in temp container', tab);
      await this.reloadTabInTempContainer(tab);
      return;
    }

    if (tab.url.startsWith('moz-extension://')) {
      debug('[maybeReloadTabInTempContainer] moz-extension:// tab, do something special', tab);
      await this.handleMultiAccountContainersConfirmPage(tab);
      return;
    }

    debug('[maybeReloadTabInTempContainer] not a home/new/moz tab, we dont handle that', tab);
  }


  async handleMultiAccountContainersConfirmPage(tab) {
    // so this is *probably* the confirm page from multi-account-containers
    // i need to reach out to the multi-account-containers devs, maybe its possible
    // to handle this in a cleaner fashion
    const multiAccountMatch = tab.url.match(/moz-extension:\/\/[^/]*\/confirm-page.html\?url=/);
    if (multiAccountMatch) {
      debug('[handleMultiAccountContainersConfirmPage] is intervening', tab);
      const parsedURL = new URL(tab.url);
      debug('[handleMultiAccountContainersConfirmPage] parsed url', parsedURL);
      const queryParams = parsedURL.search.split('&').map(param => param.split('='));
      debug('[handleMultiAccountContainersConfirmPage] query params', queryParams);
      const multiAccountTargetURL = decodeURIComponent(queryParams[0][1]);
      debug('[handleMultiAccountContainersConfirmPage] target url', multiAccountTargetURL);
      let multiAccountOriginContainer;
      if (queryParams[2]) {
        multiAccountOriginContainer = queryParams[2][1];
        debug('[handleMultiAccountContainersConfirmPage] origin container', multiAccountOriginContainer);
      }
      this.automaticModeState.multiAccountConfirmPage[multiAccountTargetURL] = true;

      debug('[handleMultiAccountContainersConfirmPage] debug',
        multiAccountTargetURL, multiAccountOriginContainer, JSON.stringify(this.automaticModeState.linkClicked), tab);
      if ((multiAccountOriginContainer && this.automaticModeState.linkClicked[multiAccountTargetURL] &&
           this.automaticModeState.linkClicked[multiAccountTargetURL].containers[multiAccountOriginContainer])
          ||
          (!multiAccountOriginContainer && tab.cookieStoreId === 'firefox-default')) {
        debug('[handleMultiAccountContainersConfirmPage] we can remove this tab, i guess - and yes this is a bit hacky', tab);
        await browser.tabs.remove(tab.id);
        debug('[handleMultiAccountContainersConfirmPage] removed multi-account-containers tab', tab.id);
        return;
      }
    }
  }


  async tryToRemove(cookieStoreId) {
    try {
      const tempTabs = await browser.tabs.query({
        cookieStoreId
      });
      if (tempTabs.length > 0) {
        debug('[tryToRemoveContainer] not removing container because it still has tabs', cookieStoreId, tempTabs.length);
        return;
      }
      debug('[tryToRemoveContainer] no tabs in temp container anymore, deleting container', cookieStoreId);
    } catch (error) {
      debug('[tryToRemoveContainer] failed to query tabs', cookieStoreId, error);
      return;
    }
    try {
      const contextualIdentity = await browser.contextualIdentities.remove(cookieStoreId);
      if (!contextualIdentity) {
        debug('[tryToRemoveContainer] couldnt find container to remove', cookieStoreId);
      } else {
        debug('[tryToRemoveContainer] container removed', cookieStoreId);
      }
      Object.keys(this.storage.local.tabContainerMap).map((tabId) => {
        if (this.storage.local.tabContainerMap[tabId] === cookieStoreId) {
          delete this.storage.local.tabContainerMap[tabId];
        }
      });
    } catch (error) {
      debug('[tryToRemoveContainer] error while removing container', cookieStoreId, error);
    }
    delete this.storage.local.tempContainers[cookieStoreId];
    await this.storage.persist();
  }


  cleanup() {
    Object.keys(this.storage.local.tempContainers).map((cookieStoreId) => {
      this.tryToRemove(cookieStoreId);
    });
  }
}

module.exports = Container;
