
/** This hook updates platform configuration files based on preferences and config-file data defined in config.xml.
    Currently only the AndroidManifest.xml and IOS *-Info.plist file are supported.
    Preferences:
    1.  Preferences defined outside of the platform element will apply to all platforms
    2.  Preferences defined inside a platform element will apply only to the specified platform
    3.  Platform preferences take precedence over common preferences
    4.  The preferenceMappingData object contains all of the possible custom preferences to date including the
        target file they belong to, parent element, and destination element or attribute
    Config Files
    1.  config-file elements MUST be defined inside a platform element, otherwise they will be ignored.
    2.  config-file target attributes specify the target file to update. (AndroidManifest.xml or *-Info.plist)
    3.  config-file parent attributes specify the parent element (AndroidManifest.xml) or parent key (*-Info.plist)
        that the child data will replace or be appended to.
    4.  config-file elements are uniquely indexed by target AND parent for each platform.
    5.  If there are multiple config-file's defined with the same target AND parent, the last config-file will be used
    6.  Elements defined WITHIN a config-file will replace or be appended to the same elements relative to the parent element
    7.  If a unique config-file contains multiples of the same elements (other than uses-permssion elements which are
        selected by by the uses-permission name attribute), the last defined element will be retrieved.
    Examples:
    AndroidManifest.xml
    NOTE: For possible manifest values see http://developer.android.com/guide/topics/manifest/manifest-intro.html
    <platform name="android">
        //These preferences are actually available in Cordova by default although not currently documented
        <preference name="android-minSdkVersion" value="8" />
        <preference name="android-maxSdkVersion" value="19" />
        <preference name="android-targetSdkVersion" value="19" />
        //custom preferences examples
        <preference name="android-windowSoftInputMode" value="stateVisible" />
        <preference name="android-installLocation" value="auto" />
        <preference name="android-launchMode" value="singleTop" />
        <preference name="android-activity-hardwareAccelerated" value="false" />
        <preference name="android-manifest-hardwareAccelerated" value="false" />
        <preference name="android-configChanges" value="orientation" />
        <preference name="android-theme" value="@android:style/Theme.Black.NoTitleBar" />
        <config-file target="AndroidManifest.xml" parent="/*>
            <supports-screens
                android:xlargeScreens="false"
                android:largeScreens="false"
                android:smallScreens="false" />
            <uses-permission android:name="android.permission.READ_CONTACTS" android:maxSdkVersion="15" />
            <uses-permission android:name="android.permission.WRITE_CONTACTS" />
        </config-file>
    </platform>
    *-Info.plist
    <platform name="ios">
        <config-file platform="ios" target="*-Info.plist" parent="UISupportedInterfaceOrientations">
            <array>
                <string>UIInterfaceOrientationLandscapeOmg</string>
            </array>
        </config-file>
        <config-file platform="ios" target="*-Info.plist" parent="SomeOtherPlistKey">
            <string>someValue</string>
        </config-file>
    </platform>
    NOTE: Currently, items aren't removed from the platform config files if you remove them from config.xml.
          For example, if you add a custom permission, build the remove it, it will still be in the manifest.
          If you make a mistake, for example adding an element to the wrong parent, you may need to remove and add your platform,
          or revert to your previous manifest/plist file.
    TODO: We may need to capture all default manifest/plist elements/keys created by Cordova along with any plugin elements/keys to compare against custom elements to remove.
 */

// global vars


const fs = require("fs"),
      path = require("path"),
      et = require("elementtree"),
      plist = require('plist');

// thanks to dpa99c/cordova-custom-config !
const manifestPath = {
    cordovaAndroid6: 'platforms/android/AndroidManifest.xml',
    cordovaAndroid7: 'platforms/android/app/src/main/AndroidManifest.xml'
};
function getAndroidManifestFilePath(rootdir) {
    var cordovaAndroid6Path = path.join(rootdir, manifestPath.cordovaAndroid6);
    var cordovaAndroid7Path = path.join(rootdir, manifestPath.cordovaAndroid7);

    if(fs.existsSync(cordovaAndroid7Path)){
        return cordovaAndroid7Path;
    }else if(fs.existsSync(cordovaAndroid6Path)){
        return cordovaAndroid6Path;
    }else{
        throw "Can't find AndroidManifest.xml in platforms/Android";
    }
}

module.exports = function(context) {

    const cordovaUtil = require('cordova-lib/src/cordova/util');
    const rootdir = cordovaUtil.isCordova();

    const platformConfig = (function(){
        /*  Global object that defines the available custom preferences for each platform.
         Maps a config.xml preference to a specific target file, parent element, and destination attribute or element
         */
        const preferenceMappingData = {
            'android': {
                'android-manifest-hardwareAccelerated': {target: 'AndroidManifest.xml', parent: './', destination: 'android:hardwareAccelerated'},
                'android-installLocation': {target: 'AndroidManifest.xml', parent: './', destination: 'android:installLocation'},
                'android-activity-hardwareAccelerated': {target: 'AndroidManifest.xml', parent: 'application', destination: 'android:hardwareAccelerated'},
                'android-configChanges': {target: 'AndroidManifest.xml', parent: "__cordovaMainActivity__", destination: 'android:configChanges'},
                'android-launchMode': {target: 'AndroidManifest.xml', parent: "__cordovaMainActivity__", destination: 'android:launchMode'},
                'android-theme': {target: 'AndroidManifest.xml', parent: "__cordovaMainActivity__", destination: 'android:theme'},
                'android-windowSoftInputMode': {target: 'AndroidManifest.xml', parent: "__cordovaMainActivity__", destination: 'android:windowSoftInputMode'},
                'android-applicationName': {target: 'AndroidManifest.xml', parent: 'application', destination: 'android:name'}
            },
            'ios': {}
        };
        let configXmlData, preferencesData;

        return {
            // Parses a given file into an elementtree object
            parseElementtreeSync: function (filename) {
                var contents = fs.readFileSync(filename, 'utf-8');
                if(contents) {
                    //Windows is the BOM. Skip the Byte Order Mark.
                    contents = contents.substring(contents.indexOf('<'));
                }
                return new et.ElementTree(et.XML(contents));
            },

            // Converts an elementtree object to an xml string.  Since this is used for plist values, we don't care about attributes
            eltreeToXmlString: function (data) {
                const tag = data.tag;
                let el = '<' + tag + '>';

                if(data.text && data.text.trim()) {
                    el += data.text.trim();
                } else {
                    data.getchildren().forEach(function (child) {
                        el += platformConfig.eltreeToXmlString(child);
                    });
                }

                el += '</' + tag + '>';
                return el;
            },

            // Parses the config.xml into an elementtree object and stores in the config object
            getConfigXml: function () {
                if(!configXmlData) {
                    configXmlData = this.parseElementtreeSync(path.join(rootdir, 'config.xml'));
                }

                return configXmlData;
            },

            /* Retrieves all <preferences ..> from config.xml and returns a map of preferences with platform as the key.
               If a platform is supplied, common prefs + platform prefs will be returned, otherwise just common prefs are returned.
             */
            getPreferences: function (platform) {
                const configXml = this.getConfigXml();

                //init common config.xml prefs if we haven't already
                if(!preferencesData) {
                    preferencesData = {
                        common: configXml.findall('preference')
                    };
                }

                let prefs = preferencesData.common || [];
                if(platform) {
                    if(!preferencesData[platform]) {
                        preferencesData[platform] = configXml.findall('platform[@name=\'' + platform + '\']/preference');
                    }
                    prefs = prefs.concat(preferencesData[platform]);
                }

                return prefs;
            },

            /* Retrieves all configured xml for a specific platform/target/parent element nested inside a platforms config-file
               element within the config.xml.  The config-file elements are then indexed by target|parent so if there are
               any config-file elements per platform that have the same target and parent, the last config-file element is used.
             */
            getConfigFilesByTargetAndParent: function (platform) {
                const configFileData = this.getConfigXml().findall('platform[@name=\'' + platform + '\']/config-file');

                let result = {};

                configFileData.forEach(function(item) {

                    let parent = item.attrib.parent;
                    //if parent attribute is undefined /* or */, set parent to top level elementree selector
                    if(!parent || parent === '/*' || parent === '*/') {
                        parent = './';
                    }
                    const key = item.attrib.target + '|' + parent;

                    result[key] = item;
                });

                return result;
            },

            // Parses the config.xml's preferences and config-file elements for a given platform
            parseConfigXml: function (platform) {
                const configData = {};
                this.parsePreferences(configData, platform);
                this.parseConfigFiles(configData, platform);

                return configData;
            },

            // Retrieves the config.xml's pereferences for a given platform and parses them into JSON data
            parsePreferences: function (configData, platform) {
                const preferences = this.getPreferences(platform),
                    type = 'preference';

                preferences.forEach( function (preference) {
                    // check if there are specific configuration to map to config for this platform
                    if (!preferenceMappingData[platform]) {
                        return;
                    }
                    const prefMappingData = preferenceMappingData[platform][preference.attrib.name];
                    let target,
                        prefData;

                    if (prefMappingData) {
                        prefData = {
                            parent: prefMappingData.parent,
                            type: type,
                            destination: prefMappingData.destination,
                            data: preference
                        };

                        target = prefMappingData.target;
                        if(!configData[target]) {
                            configData[target] = [];
                        }
                        configData[target].push(prefData);
                    }
                });
            },

            // Retrieves the config.xml's config-file elements for a given platform and parses them into JSON data
            parseConfigFiles: function (configData, platform) {
                const configFiles = this.getConfigFilesByTargetAndParent(platform),
                    type = 'configFile';

                for (let key in configFiles) {
                    if (configFiles.hasOwnProperty(key)) {
                        const configFile = configFiles[key];

                        const keyParts = key.split('|');
                        const target = keyParts[0];
                        const parent = keyParts[1];
                        const items = configData[target] || [];

                        configFile.getchildren().forEach( function (element) {
                            items.push({
                                parent: parent,
                                type: type,
                                destination: element.tag,
                                data: element
                            });
                        });

                        configData[target] = items;
                    }
                }
            },

            // Parses config.xml data, and update each target file for a specified platform
            updatePlatformConfig: function (platform) {
                const configData = this.parseConfigXml(platform),
                    platformPath = path.join(rootdir, 'platforms', platform);

                for (let targetFileName in configData) {
                    if (configData.hasOwnProperty(targetFileName)) {
                        const configItems = configData[targetFileName];

                        let projectName, targetFile;

                        if (platform === 'ios' && targetFileName.indexOf("Info.plist") > -1) {
                            projectName = platformConfig.getConfigXml().findtext('name');
                            targetFile = path.join(platformPath, projectName, projectName + '-Info.plist');
                            platformConfig.updateIosPlist(targetFile, configItems);
                        } else if (platform === 'android' && targetFileName === 'AndroidManifest.xml') {
                            targetFile = getAndroidManifestFilePath(rootdir);
                            platformConfig.updateAndroidManifest(targetFile, configItems);
                        }
                    }
                }
            },

            getMainAndroidActivityNode: function(rootManifest) {
                const cordovaApp = "application/activity/intent-filter/action[@android:name='android.intent.action.MAIN']/../..";
                const tempNode = rootManifest.find(cordovaApp);
                return tempNode;
            },

            // Updates the AndroidManifest.xml target file with data from config.xml
            updateAndroidManifest: function (targetFile, configItems) {
                const tempManifest = platformConfig.parseElementtreeSync(targetFile),
                    root = tempManifest.getroot();
                const mainActivity = platformConfig.getMainAndroidActivityNode(root);

                configItems.forEach( function (item) {

                    let parentEl;
                    if (item.parent === "__cordovaMainActivity__") {
                        parentEl = mainActivity;
                    } else {
                        // if parent is not found on the root, child/grandchild nodes are searched
                        parentEl = root.find(item.parent) || root.find('*/' + item.parent);
                    }

                    const data = item.data;
                    let childSelector = item.destination,
                        childEl;

                    if(!parentEl) {
                        return;
                    }

                    if(item.type === 'preference') {
                        parentEl.attrib[childSelector] = data.attrib['value'];
                    } else {
                        // since there can be multiple uses-permission elements, we need to select them by unique name
                        if(childSelector === 'uses-permission') {
                            childSelector += '[@android:name=\'' + data.attrib['android:name'] + '\']';
                        }

                        childEl = parentEl.find(childSelector);
                        // if child element doesnt exist, create new element
                        if(!childEl) {
                            childEl = new et.Element(item.destination);
                            parentEl.append(childEl);
                        }

                        if (typeof data === "object") {
                            // copy all config.xml data except for the generated _id property
                            for (let key in data) {
                                // skip loop if the property is from prototype
                                if (!data.hasOwnProperty(key)) continue;

                                if(key !== '_id') {
                                    childEl[key] = data[key];
                                }
                            }
                        }
                    }
                });

                fs.writeFileSync(targetFile, tempManifest.write({indent: 4}), 'utf-8');
                console.log("Wrote AndroidManifest.xml: "+targetFile);
            },

            /* Updates the *-Info.plist file with data from config.xml by parsing to an xml string, then using the plist
               module to convert the data to a map.  The config.xml data is then replaced or appended to the original plist file
             */
            updateIosPlist: function (targetFile, configItems) {
                const infoPlist = plist.parse(fs.readFileSync(targetFile, 'utf-8'));
                let tempInfoPlist;

                configItems.forEach( function (item) {
                    const key = item.parent;
                    const plistXml = '<plist><dict><key>' + key + '</key>' +
                          platformConfig.eltreeToXmlString(item.data) + '</dict></plist>';

                    const configPlistObj = plist.parse(plistXml);
                    infoPlist[key] = configPlistObj[key];
                });

                tempInfoPlist = plist.build(infoPlist);
                tempInfoPlist = tempInfoPlist.replace(/<string>[\s\r\n]*<\/string>/g,'<string></string>');
                fs.writeFileSync(targetFile, tempInfoPlist, 'utf-8');
                console.log("Wrote iOS Plist: "+ targetFile);
            }
        };
    })();

    // Main
    (function () {
        if (rootdir) {
            // go through each of the platform directories that have been prepared
            const platforms = [];

            fs.readdirSync('platforms').forEach( function (file) {
                if (fs.statSync(path.resolve('platforms', file)).isDirectory()) {
                    platforms.push(file);
                }
            });

            platforms.forEach( function (platform) {
                try {
                    platform = platform.trim().toLowerCase();
                    console.log("Processing settings for platform: "+ platform);
                    platformConfig.updatePlatformConfig(platform);
                } catch (e) {
                    console.error(e);
                }
            });
        }
    })();
}
