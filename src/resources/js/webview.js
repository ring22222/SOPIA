////////////////////////////////////////////////////////////////
//  파일 : webview.js                                         //
//  작성자 : mobbing                                          //
//  주석 : elementLoad 이후 webview element에 대한 스크립트     //
///////////////////////////////////////////////////////////////

const browserEvent = async (evt) => {
	if ( typeof evt.event !== 'string' ) {
		return;
	}

	if ( !['onmessage', 'live_rank' ].includes(evt.event.trim()) ) {
		console.log(`[${evt.event.trim()}]`, evt.data);
	}

	switch ( evt.event.trim() ) {

		case 'snsLoginCallback':
			evt.data = evt.data.result;

		case 'loginCallback':
            const user = deserialize(evt.data, spoon.User);
			$sopia.user = user;
			console.log('setting user', $sopia.user);
            await asleep(1000);

			//const unique_id = await webview.executeJavaScript(`navigator.userAgent.replace(/ /gi, '').toLowerCase();`);
			const unique_id = navigator.userAgent.replace(/ /gi, '').toLowerCase();
			const refToken = await webview.executeJavaScript('localStorage.SPOONCAST_KR_refreshToken');
			const token = await webview.executeJavaScript('localStorage.SPOONCAST_KR_authKey');

			if ( sopia.config.sopia['keep-login'] && !['email', 'phone'].includes(user.sns_type.toLowerCase()) && (token && refToken) ) {
				console.log('token', token, 'refToken', refToken);
				await webview.executeJavaScript(`getProps().AuthActions.putTokens({ device_unique_id: '${unique_id}', refresh_token: '${refToken}', user_id: ${$sopia.user.id} });`);
			}
			const t = $sopia.token || token;
			console.log('Emit setAuthKey Event', t);
			browserEvent({ event: 'setAuthKey', data: t });

            break;
		case 'setAuthKey':
			if ( evt.data ) {
				const token = evt.data.replace('Bearer ', '');
				const refToken = await webview.executeJavaScript('localStorage.SPOONCAST_KR_refreshToken');
				if ( $sopia.user ) {
					$sopia.logonUser = $sopia.user;
					$sopia.logonUser.token = $sopia.token = token;
					$sopia.logonUser.refresh_token = $sopia.refToken = refToken;
					console.log('login', $sopia.logonUser);
				} else {
					$sopia.token = token;
				}
			}
			hideSpinner();
			break;
        
        case 'SOCKET_LIVE_LEAVE':
            if ( sopia.sock ) {
                sopia.sock.destroy();
                sopia.sock = null;
				writeLog('INFO', `Destroy socket because live leave`);
            }
            break;

        case 'getLivesToken Success':
			window.live_token = evt.data.data.results[0].jwt;
			break;
        case 'live_shadowjoin':
		case 'live_join':
			try {

            if ( evt.data.type === spoon.LiveType.LIVE_RSP ||
                (($sopia.user && evt.data.author) && evt.data.author.id === $sopia.user.id) ) {
				// mute sound
				setTimeout(() => {
					webview.executeJavaScript('toggleMute()');
				}, 100);

                let liveId = evt.data.live_id;

                if ( !liveId ) {
                    return;
                }
                
				let sock = $sopia.liveMap.get(liveId);
				if ( sock ) {
					writeLog('INFO', `Destroy socket join at ${liveId}`);
					console.log('socket', sock);
					sock.destroy();
                }

				const liveStruct = new spoon.LiveInfo();
				liveStruct.id = liveId;
				liveStruct._client = $sopia;

				sopia.sock = await liveStruct.join(window.live_token);
				sopia.sock.on(spoon.LiveEvent.LIVE_EVENT_ALL, sopia.onmessage);
				writeLog('INFO', `Create socket join at ${liveId}`);
                sopia.me = $sopia.user;
                
            
                // update props
                webview.executeJavaScript('getProps()')
                .then(d => {
                    sopia.props = d;
                });

				writeLog('SUCCESS', `Live join success (${liveId})`);

				if ( !window.DEBUG_MODE ) {
					if ( sopia.me.tag.toString() !== sopia.config.license.id.toString() ) {
						// 라이센스 id 와 로그인 한 id가 다르다면,
						window.location.assign('license.html?noti=로그인 한 계정과 인증 계정이 다릅니다.');
					}
				}

				const nowDate = new Date();
				const nDay = nowDate.yyyymmdd('-');
				const nTime = nowDate.hhMMss('-') + '-' + nowDate.getMilliseconds();

				const { res: { results: [ live ] } } = await $sopia.api.lives.info(liveId);
				sopia.live = live;
				const roomData = {
					title: live.title,
					img_url: live.img_url,
					created: live.created,
					nickname: live.author.nickname,
					tag: live.author.tag,
					room: liveId
				};
				writeLog('SUCCESS', `Live join success (${liveId})`);

				// send join data to firebase server.
				sopia.debug("================== send join data to firebase server ==================");
				axios({
					url: `${sopia.config['api-url']}/join-log/${nDay}/${nTime}.json`,
					method: 'put',
					headers: {
						'Content-Type': 'application/json'
					},
					data: roomData
				}).then(res => {
					sopia.debug("success!");
				}).catch(err => {
					sopia.debug("fail!");
					sopia.error(err);
				});
			}
			} catch(err) {
				console.error(err);
			}
			break;
		// E: live_join
	}
};

window.addEventListener('DOMContentLoaded', () => {

    //webview에서 받은 콘솔로그를 출력하지만, 그것이 라이브의 이벤트일 경우는 라이브 이벤트로 처리한다.
    webview.addEventListener('console-message', (e) => {
        try {
            switch(e.level) {
                case -1: {
                    console.debug(e.message);
                } break;
                case 0: {
                    const obj = JSON.parse(e.message);
					browserEvent(obj);
                } break;
                case 1: {
                    //console.warn(e.message);
                } break;
                case 2: {
                    //console.error(e.message);
                } break;
            }
        } catch (err) {
        }
    });

    //webview의 로딩이 끝났을 때, BrowserInject.js 를 추가한다.
    webview.addEventListener('did-finish-load', () => {
        //3초 이내는 브라우저 로딩을 단 한 번으로 친다.
        if ( webview.isLoaded ) {
            return;
        }
        webview.isLoaded = true;
        setTimeout(async () => {
			webview.insertCSS('.live-comment-list-item-container .comment-wrap .comment .comment-text.chat-highlight { border-color: #ffb047 !important }');
			webview.insertCSS('.live-comment-list-item-container .comment-wrap .comment .comment-name .badge.subscribe { background-color: #ffb047 !important }');
			const userStr = await webview.executeJavaScript('localStorage.SPOONCAST_KR_userInfo');
			if ( userStr ) {
				browserEvent({ event: 'loginCallback', data: JSON.parse(userStr) });
			}
        }, 3000);

		sopia.wlog('INFO', 'Webview dom-ready.');

        fs.readFile(getPath("src/resources/js/BrowserInject.js", true), {encoding: "utf8"}, (err, data) => {
            if ( err ) {
                throw err;
            }
            webview.executeJavaScript(data);
			sopia.wlog('INFO', 'Write browser inject js');
            if ( sopia.config.autologin.enable ) {
                if ( sopia.config.devel && sopia.config.devel["토큰"] ) {
                    //do not autologin
                } else {
                    webview.executeJavaScript(`autoLogin('${sopia.config.autologin.type}', '${sopia.config.autologin.id}', '${sopia.config.autologin.passwd}')`);
                }
            }
        });
    });


});
